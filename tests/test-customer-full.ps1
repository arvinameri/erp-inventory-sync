# Path: tests/test-customer-full.ps1
# Compatible with PowerShell 5+

param(
    [string]$BaseUrl    = "http://localhost:3000",
    [int]   $TestUserId = 0,
    [switch]$SkipFullSync
)

$ErrorActionPreference = "Continue"

function Write-Section([string]$title) {
    Write-Host ""
    Write-Host ("=" * 65) -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("=" * 65) -ForegroundColor Cyan
}

function Invoke-ApiTest {
    param(
        [string]$label,
        [string]$method,
        [string]$url,
        [hashtable]$body = $null
    )
    Write-Host ""
    Write-Host "[ TEST ] $label" -ForegroundColor Yellow
    Write-Host "         $method $url" -ForegroundColor DarkGray
    try {
        $params = @{
            Uri             = $url
            Method          = $method
            Headers         = @{ "Content-Type" = "application/json" }
            TimeoutSec      = 60
            UseBasicParsing = $true
        }
        if ($null -ne $body) {
            $params.Body = ($body | ConvertTo-Json -Depth 10 -Compress)
        }
        $raw      = Invoke-WebRequest @params
        $response = $raw.Content | ConvertFrom-Json
        Write-Host "         OK HTTP $($raw.StatusCode)" -ForegroundColor Green
        $response | ConvertTo-Json -Depth 6 | Write-Host
        return $response
    } catch {
        $code = "?"
        if ($_.Exception.Response -ne $null) {
            $code = [int]$_.Exception.Response.StatusCode
        }
        Write-Host "         FAIL HTTP $code  -- $($_.Exception.Message)" -ForegroundColor Red
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            Write-Host "         Body: $($reader.ReadToEnd())" -ForegroundColor DarkRed
        } catch {}
        return $null
    }
}

Write-Section "CUSTOMER SYNC TEST SUITE"
Write-Host "  BaseUrl : $BaseUrl"
Write-Host "  Started : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# 1. Health
Write-Section "1. Server health"
Invoke-ApiTest -label "GET /health" -method "GET" -url "$BaseUrl/health"

# 2. Route listing
Write-Section "2. Route listing"
Invoke-ApiTest -label "GET /customer/status" -method "GET" -url "$BaseUrl/customer/status"

# 3. Status before
Write-Section "3. Job status -- before"
Invoke-ApiTest -label "GET /customer/status" -method "GET" -url "$BaseUrl/customer/status"

# 4. Portal users preview
Write-Section "4. Portal users preview"
$previewUrl = "$BaseUrl/customer/portal-users?page=1" + "&size=5"
$preview = Invoke-ApiTest -label "GET /customer/portal-users" -method "GET" -url $previewUrl

# 5. Single user sync
Write-Section "5. Single user sync"
$uid = $TestUserId
if ($uid -eq 0 -and $preview -ne $null -and $preview.users -ne $null -and $preview.users.Count -gt 0) {
    $uid = $preview.users[0].id
    Write-Host "  Auto-selected userId=$uid from preview" -ForegroundColor Magenta
}

if ($uid -gt 0) {
    Write-Host "  -- First call (expect: created or already_exists) --" -ForegroundColor Magenta
    Invoke-ApiTest -label "POST /customer/single (1st)" -method "POST" -url "$BaseUrl/customer/single" -body @{ userId = $uid }

    Write-Host "  -- Second call (expect: already_exists) --" -ForegroundColor Magenta
    Invoke-ApiTest -label "POST /customer/single (idempotency)" -method "POST" -url "$BaseUrl/customer/single" -body @{ userId = $uid }
} else {
    Write-Host "  WARNING: No userId available -- pass -TestUserId <id>" -ForegroundColor DarkYellow
}

# 6. Validation
Write-Section "6. Validation -- missing userId (expect 400)"
Invoke-ApiTest -label "POST /customer/single -- no body" -method "POST" -url "$BaseUrl/customer/single" -body @{}

# 7. Full sync
Write-Section "7. Full customer sync"
if ($SkipFullSync) {
    Write-Host "  Skipped (-SkipFullSync)" -ForegroundColor DarkGray
} else {
    Write-Host "  WARNING: This will create real contacts in Hesabfa." -ForegroundColor DarkYellow
    $confirm = Read-Host "  Continue? (y/n)"
    if ($confirm -eq "y") {
        Invoke-ApiTest -label "POST /customer/sync (REAL)" -method "POST" -url "$BaseUrl/customer/sync" -body @{ dryRun = $false }
    } else {
        Write-Host "  Running dry-run instead..." -ForegroundColor DarkGray
        Invoke-ApiTest -label "POST /customer/sync (dry-run)" -method "POST" -url "$BaseUrl/customer/sync" -body @{ dryRun = $true }
    }
}

# 8. Status after
Write-Section "8. Job status -- after"
Invoke-ApiTest -label "GET /customer/status" -method "GET" -url "$BaseUrl/customer/status"

Write-Section "DONE -- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"