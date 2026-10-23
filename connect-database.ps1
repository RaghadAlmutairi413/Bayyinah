$ErrorActionPreference = 'Stop'

$python = Join-Path $PSScriptRoot 'venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw "Python virtual environment not found at '$python'."
}

$securePassword = Read-Host 'PostgreSQL password for the postgres user' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$passwordBytes = $null
$random = $null

try {
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $env:BAYYINAH_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        $passwordPointer
    )
    if ([string]::IsNullOrWhiteSpace($env:BAYYINAH_DB_PASSWORD)) {
        throw 'A PostgreSQL password is required.'
    }

    if ([string]::IsNullOrWhiteSpace($env:BAYYINAH_DJANGO_SECRET_KEY)) {
        $passwordBytes = New-Object byte[] 64
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        $random.GetBytes($passwordBytes)
        $env:BAYYINAH_DJANGO_SECRET_KEY = [Convert]::ToBase64String($passwordBytes)
    }

    Push-Location $PSScriptRoot
    try {
        & $python manage.py migrate
        if ($LASTEXITCODE -ne 0) {
            throw 'Database migration failed. Check the connection and migration output above.'
        }

        & $python manage.py runserver
        if ($LASTEXITCODE -ne 0) {
            throw 'Django server stopped with an error.'
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:BAYYINAH_DB_PASSWORD -ErrorAction SilentlyContinue
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    if ($null -ne $passwordBytes) {
        [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    }
    if ($null -ne $random) {
        $random.Dispose()
    }
    if ($null -ne $securePassword) {
        $securePassword.Dispose()
    }
}
