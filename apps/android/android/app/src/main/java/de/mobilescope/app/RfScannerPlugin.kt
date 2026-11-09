package de.mobilescope.app

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult as BleScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import java.time.Instant

/**
 * Nativer Scanner für mobilescope. Liefert ausschließlich empfangene Metadaten
 * (BSSID/SSID/RSSI/Frequenz bzw. BLE-Adresse/Name/RSSI/Company-ID) an die Webschicht.
 * Keine Verbindung zu fremden Geräten, keine Positionsabfrage, keine Persistenz.
 *
 * Ereignisse an die Webschicht:
 *  - "observations": { items: Observation[] }   (gebündelt)
 *  - "status":       { code, message }          (z. B. SCAN_THROTTLED, SCAN_FAILED)
 */
@CapacitorPlugin(
    name = "RfScanner",
    permissions = [
        Permission(alias = "location", strings = [Manifest.permission.ACCESS_FINE_LOCATION]),
        Permission(alias = "nearbyWifi", strings = [Manifest.permission.NEARBY_WIFI_DEVICES]),
        Permission(alias = "bluetooth", strings = [Manifest.permission.BLUETOOTH_SCAN]),
    ],
)
class RfScannerPlugin : Plugin() {

    private val main = Handler(Looper.getMainLooper())
    private var wifiReceiver: BroadcastReceiver? = null
    private var wifiTick: Runnable? = null
    private var bleCallback: ScanCallback? = null
    private var wifiIntervalMs = DEFAULT_WIFI_INTERVAL_MS.toLong()

    private val bleBuffer = ArrayList<JSObject>()
    private var bleFlush: Runnable? = null

    private val wifi get() = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val btAdapter: BluetoothAdapter? get() =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    // ---------------------------------------------------------------- Status

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val loc = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val ret = JSObject()
        ret.put("platform", "android")
        ret.put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        ret.put("androidRelease", Build.VERSION.RELEASE)
        ret.put("sdk", Build.VERSION.SDK_INT)
        ret.put("wifiEnabled", wifi.isWifiEnabled)
        ret.put("bluetoothEnabled", btAdapter?.isEnabled == true)
        ret.put("bleSupported", context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE))
        ret.put("locationEnabled", loc.isLocationEnabled)
        ret.put("wifiScanThrottleEnabled", wifi.isScanThrottleEnabled)
        ret.put("permLocation", granted(Manifest.permission.ACCESS_FINE_LOCATION))
        ret.put("permNearbyWifi", granted(Manifest.permission.NEARBY_WIFI_DEVICES))
        ret.put("permBluetoothScan", granted(Manifest.permission.BLUETOOTH_SCAN))
        ret.put("scanning", wifiTick != null || bleCallback != null)
        call.resolve(ret)
    }

    // ----------------------------------------------------------------- Start

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun startScan(call: PluginCall) {
        val wantWifi = call.getBoolean("wifi", true) == true
        val wantBle = call.getBoolean("ble", true) == true
        wifiIntervalMs = (call.getInt("wifiIntervalMs", DEFAULT_WIFI_INTERVAL_MS) ?: DEFAULT_WIFI_INTERVAL_MS)
            .toLong().coerceAtLeast(MIN_WIFI_INTERVAL_MS)

        val missing = buildList {
            if (wantWifi && !granted(Manifest.permission.NEARBY_WIFI_DEVICES)) add("NEARBY_WIFI_DEVICES")
            if ((wantWifi || wantBle) && !granted(Manifest.permission.ACCESS_FINE_LOCATION)) add("ACCESS_FINE_LOCATION")
            if (wantBle && !granted(Manifest.permission.BLUETOOTH_SCAN)) add("BLUETOOTH_SCAN")
        }
        if (missing.isNotEmpty()) {
            call.reject("Fehlende Berechtigungen: ${missing.joinToString()}", "PERMISSION_DENIED")
            return
        }

        stopInternal()
        val started = JSArray()
        if (wantWifi) {
            if (startWifi()) started.put("wifi")
        }
        if (wantBle) {
            if (startBle()) started.put("ble")
        }
        val ret = JSObject()
        ret.put("started", started)
        call.resolve(ret)
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        stopInternal()
        call.resolve()
    }

    override fun handleOnDestroy() {
        stopInternal()
        super.handleOnDestroy()
    }

    // ------------------------------------------------------------------ WLAN

    @SuppressLint("MissingPermission")
    private fun startWifi(): Boolean {
        if (!wifi.isWifiEnabled) {
            status("WIFI_OFF", "WLAN ist ausgeschaltet; keine WLAN-Beobachtung möglich.")
            return false
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                val updated = intent?.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, true) ?: true
                if (!updated) status("SCAN_FAILED", "WLAN-Scan lieferte keine neuen Ergebnisse.")
                emitWifiResults()
            }
        }
        ContextCompat.registerReceiver(
            context, receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        wifiReceiver = receiver

        // Bereits vorhandene (ggf. ältere) Ergebnisse sofort anzeigen; resultAgeMs macht das Alter sichtbar.
        emitWifiResults()

        val tick = object : Runnable {
            override fun run() {
                @Suppress("DEPRECATION")
                val ok = wifi.startScan()
                if (!ok) {
                    status(
                        "SCAN_THROTTLED",
                        "Android hat den WLAN-Scan gedrosselt oder abgelehnt (Vordergrund: ca. 4 Scans / 2 Min).",
                    )
                }
                main.postDelayed(this, wifiIntervalMs)
            }
        }
        wifiTick = tick
        main.post(tick)
        return true
    }

    @SuppressLint("MissingPermission")
    private fun emitWifiResults() {
        val results = try {
            wifi.scanResults
        } catch (e: SecurityException) {
            status("PERMISSION_CHANGED", "Berechtigung für WLAN-Ergebnisse fehlt: ${e.message}")
            return
        }
        val now = SystemClock.elapsedRealtime()
        val nowIso = Instant.now().toString()
        val items = JSArray()
        for (r in results) {
            val o = JSObject()
            o.put("source", "WIFI")
            o.put("scanOrigin", "OS_INITIATED")
            o.put("identifier", r.BSSID ?: continue)
            @Suppress("DEPRECATION")
            val ssid = r.SSID
            if (!ssid.isNullOrEmpty()) o.put("name", ssid)
            o.put("rssi", r.level)
            o.put("frequencyMhz", r.frequency)
            o.put("capabilities", capabilityList(r.capabilities))
            o.put("resultAgeMs", (now - r.timestamp / 1000).coerceAtLeast(0))
            o.put("ts", nowIso)
            items.put(o)
        }
        if (items.length() > 0) emit(items)
    }

    private fun capabilityList(raw: String?): JSArray {
        val arr = JSArray()
        if (raw.isNullOrEmpty()) return arr
        Regex("\\[([^\\]]+)]").findAll(raw).forEach { arr.put(it.groupValues[1]) }
        return arr
    }

    // ------------------------------------------------------------------- BLE

    @SuppressLint("MissingPermission")
    private fun startBle(): Boolean {
        val adapter = btAdapter
        if (adapter == null || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            status("SCAN_FAILED", "BLE wird auf diesem Gerät nicht unterstützt.")
            return false
        }
        if (!adapter.isEnabled) {
            status("BLUETOOTH_OFF", "Bluetooth ist ausgeschaltet; keine BLE-Beobachtung möglich.")
            return false
        }
        val scanner = adapter.bluetoothLeScanner ?: run {
            status("SCAN_FAILED", "BLE-Scanner nicht verfügbar.")
            return false
        }
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: BleScanResult) = buffer(result)
            override fun onBatchScanResults(results: MutableList<BleScanResult>) = results.forEach(::buffer)
            override fun onScanFailed(errorCode: Int) = status("SCAN_FAILED", "BLE-Scan fehlgeschlagen (Code $errorCode).")
        }
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build()
        scanner.startScan(null, settings, cb)
        bleCallback = cb

        // Gebündelte Auslieferung, damit die UI bei vielen Advertising-Paketen nicht überlastet wird.
        val flush = object : Runnable {
            override fun run() {
                flushBle()
                main.postDelayed(this, BLE_FLUSH_MS)
            }
        }
        bleFlush = flush
        main.postDelayed(flush, BLE_FLUSH_MS)
        return true
    }

    @SuppressLint("MissingPermission")
    private fun buffer(r: BleScanResult) {
        val o = JSObject()
        o.put("source", "BLE")
        o.put("scanOrigin", "APP")
        o.put("identifier", r.device.address)
        val name = r.scanRecord?.deviceName
        if (!name.isNullOrEmpty()) o.put("name", name)
        o.put("rssi", r.rssi)
        val mfg = r.scanRecord?.manufacturerSpecificData
        if (mfg != null && mfg.size() > 0) o.put("bleCompanyId", mfg.keyAt(0))
        o.put("resultAgeMs", ((SystemClock.elapsedRealtimeNanos() - r.timestampNanos) / 1_000_000).coerceAtLeast(0))
        o.put("ts", Instant.now().toString())
        synchronized(bleBuffer) { bleBuffer.add(o) }
    }

    private fun flushBle() {
        val batch = synchronized(bleBuffer) {
            if (bleBuffer.isEmpty()) return
            // Pro Adresse nur den jüngsten Eintrag je Intervall weitergeben.
            val latest = LinkedHashMap<String, JSObject>()
            bleBuffer.forEach { latest[it.getString("identifier") ?: ""] = it }
            bleBuffer.clear()
            latest.values
        }
        val items = JSArray()
        batch.forEach { items.put(it) }
        emit(items)
    }

    // ----------------------------------------------------------------- Helfer

    @SuppressLint("MissingPermission")
    private fun stopInternal() {
        wifiTick?.let { main.removeCallbacks(it) }
        wifiTick = null
        wifiReceiver?.let { runCatching { context.unregisterReceiver(it) } }
        wifiReceiver = null
        bleFlush?.let { main.removeCallbacks(it) }
        bleFlush = null
        bleCallback?.let { cb ->
            runCatching { btAdapter?.bluetoothLeScanner?.stopScan(cb) }
        }
        bleCallback = null
        synchronized(bleBuffer) { bleBuffer.clear() }
    }

    private fun emit(items: JSArray) {
        val data = JSObject()
        data.put("items", items)
        notifyListeners("observations", data)
    }

    private fun status(code: String, message: String) {
        val data = JSObject()
        data.put("code", code)
        data.put("message", message)
        notifyListeners("status", data)
    }

    companion object {
        private const val DEFAULT_WIFI_INTERVAL_MS = 30_000
        private const val MIN_WIFI_INTERVAL_MS = 30_000L
        private const val BLE_FLUSH_MS = 1_000L
    }
}
