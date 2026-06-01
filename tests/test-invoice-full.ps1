# Path: tests/test-invoice-full.ps1
# Compatible with PowerShell 5+

param(
    [string]$BaseUrl     = "http://localhost:3000",
    [int]   $TestOrderId = 0,
    [switch]$DryRun,
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
            TimeoutSec      = 90
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

Write-Section "INVOICE SYNC TEST SUITE"
Write-Host "  BaseUrl : $BaseUrl"
Write-Host "  DryRun  : $DryRun"
Write-Host "  Started : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# 1. Health
Write-Section "1. Server health"
Invoke-ApiTest -label "GET /health" -method "GET" -url "$BaseUrl/health"

# 2. Route listing
Write-Section "2. Route listing"
Invoke-ApiTest -label "GET /invoice" -method "GET" -url "$BaseUrl/invoice"

# 3. Status before
Write-Section "3. Job status -- before"
Invoke-ApiTest -label "GET /invoice/status" -method "GET" -url "$BaseUrl/invoice/status"

# 4. Portal orders preview
Write-Section "4. Portal orders preview (status=paid)"
$previewUrl = "$BaseUrl/invoice/portal-orders?page=1" + "&size=5" + "&status=paid"
$preview = Invoke-ApiTest -label "GET /invoice/portal-orders" -method "GET" -url $previewUrl

# 5. Single order
Write-Section "5. Check + process single order"
$oid = $TestOrderId
if ($oid -eq 0 -and $preview -ne $null -and $preview.orders -ne $null -and $preview.orders.Count -gt 0) {
    $oid = $preview.orders[0].id
    Write-Host "  Auto-selected orderId=$oid from preview" -ForegroundColor Magenta
}

if ($oid -gt 0) {
    # 5a. Check before
    Invoke-ApiTest -label "GET /invoice/check/$oid (before)" -method "GET" -url "$BaseUrl/invoice/check/$oid"

    # 5b. Process
    $isActualDryRun = $DryRun.IsPresent
    if ($isActualDryRun) {
        $label = "POST /invoice/single (DRY-RUN)"
    } else {
        $label = "POST /invoice/single (REAL)"
    }

    if (-not $isActualDryRun) {
        Write-Host "  WARNING: This will create a REAL invoice + receipt in Hesabfa." -ForegroundColor DarkYellow
        $confirm = Read-Host "  Continue? (y/n)"
        if ($confirm -ne "y") {
            $isActualDryRun = $true
            Write-Host "  Switched to dry-run." -ForegroundColor DarkGray
        }
    }

    Invoke-ApiTest -label $label -method "POST" -url "$BaseUrl/invoice/single" -body @{
        orderId = $oid
        dryRun  = $isActualDryRun
    }

    # 5c. Idempotency
    if (-not $isActualDryRun) {
        Write-Host ""
        Write-Host "  -- Idempotency check (expect: already_invoiced) --" -ForegroundColor Magenta
        Invoke-ApiTest -label "POST /invoice/single (2nd call)" -method "POST" -url "$BaseUrl/invoice/single" -body @{
            orderId = $oid
            dryRun  = $false
        }

        # 5d. Check after
        Invoke-ApiTest -label "GET /invoice/check/$oid (after)" -method "GET" -url "$BaseUrl/invoice/check/$oid"
    }
} else {
    Write-Host "  WARNING: No orderId -- pass -TestOrderId <id>" -ForegroundColor DarkYellow
}

# 6. Validation
Write-Section "6. Validation -- missing orderId (expect 400)"
Invoke-ApiTest -label "POST /invoice/single -- no body" -method "POST" -url "$BaseUrl/invoice/single" -body @{}

# 7. Full sync
Write-Section "7. Full invoice sync"
if ($SkipFullSync) {
    Write-Host "  Skipped (-SkipFullSync)" -ForegroundColor DarkGray
} else {
    Write-Host "  WARNING: This will process ALL paid orders in Hesabfa." -ForegroundColor DarkYellow
    $confirm = Read-Host "  Continue? (y/n)"
    if ($confirm -eq "y") {
        Invoke-ApiTest -label "POST /invoice/sync (REAL)" -method "POST" -url "$BaseUrl/invoice/sync" -body @{ dryRun = $false }
    } else {
        Write-Host "  Running dry-run instead..." -ForegroundColor DarkGray
        Invoke-ApiTest -label "POST /invoice/sync (dry-run)" -method "POST" -url "$BaseUrl/invoice/sync" -body @{ dryRun = $true }
    }
}

# 8. Status after
Write-Section "8. Job status -- after"
Invoke-ApiTest -label "GET /invoice/status" -method "GET" -url "$BaseUrl/invoice/status"

Write-Section "DONE -- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"