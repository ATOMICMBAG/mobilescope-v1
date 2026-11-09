# Baut die Webapp, synchronisiert sie ins Android-Projekt und erzeugt die Debug-APK.
# Capacitor 8 braucht JDK 21 (Android Studios JBR ist aktuell JDK 25 und für Gradle 8.14 zu neu).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not $env:JAVA_HOME -or $env:JAVA_HOME -notmatch 'jdk-?21') {
    $jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-21*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $jdk) { throw "JDK 21 nicht gefunden (winget install EclipseAdoptium.Temurin.21.JDK)" }
    $env:JAVA_HOME = $jdk.FullName
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }

Push-Location $root
try {
    npm run build
    Push-Location "$root\apps\android"
    npx cap sync android
    Pop-Location
    Push-Location "$root\apps\android\android"
    & .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Gradle fehlgeschlagen" }
    Pop-Location
    Write-Host "APK: $root\apps\android\android\app\build\outputs\apk\debug\app-debug.apk"
}
finally { Pop-Location }
