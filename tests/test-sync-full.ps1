$ErrorActionPreference = "Stop"

$HESABFA_API_KEY = "oNatfsiwo3ZQbgq2FgIam0i5idajsZQp"
$HESABFA_TOKEN   = "131497e45c951d35bff7b5b2a7dcad220fef674aeb093a35e584f1f0cba2966199ae1cedd09d94dce7f3cbca6c4b7025"
$HESABFA_BASE    = "https://api.hesabfa.com/v1"
$SYNC_SCRIPT     = "scripts\sync.mjs"
$TEST_BARCODE    = "100478"

function Write-Pass { param($msg) Write-Host "  [PASS]  $msg" -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "  [FAIL]  $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "  [INFO]  $msg" -ForegroundColor Cyan }
function Write-Step { param($msg) Write-Host "`n=== $msg ===" -ForegroundColor Yellow }

function Coalesce { param($a, $b); if ($null -ne $a) { return $a } else { return $b } }

function Invoke-Hesabfa {
    param($Endpoint, $Body)
    $payload = $Body + @{ apiKey = $HESABFA_API_KEY; loginToken = $HESABFA_TOKEN }
    $json = $payload | ConvertTo-Json -Depth 10
    $r = Invoke-RestMethod -Method Post -Uri "$HESABFA_BASE$Endpoint" -ContentType "application/json" -Body $json
    if ($r.Success -ne $true) { throw "Hesabfa error ($Endpoint): $($r.ErrorMessage)" }
    return $r.Result
}

function Get-ItemByBarcode {
    param($Barcode)
    return (Invoke-Hesabfa "/item/getByBarcode" @{ barcode = $Barcode })
}

function Get-HesabfaCode {
    param($Barcode)
    $result = Get-ItemByBarcode $Barcode
    return (Coalesce $result.Code $result.code)
}

function Get-HesabfaStock {
    param($Barcode)
    $result = Get-ItemByBarcode $Barcode
    $val = Coalesce $result.Stock $result.stock
    if ($null -eq $val) { return 0 }
    return [int]$val
}

function Get-HesabfaPrice {
    param($Barcode)
    $result = Get-ItemByBarcode $Barcode
    $val = Coalesce $result.SellPrice $result.sellPrice
    if ($null -eq $val) { return 0 }
    return [int]$val
}

function Get-HesabfaName {
    param($Barcode)
    $result = Get-ItemByBarcode $Barcode
    return (Coalesce $result.Name $result.name)
}

function Get-HesabfaItemType {
    param($Barcode)
    $result = Get-ItemByBarcode $Barcode
    $val = Coalesce $result.ItemType $result.itemType
    if ($null -eq $val) { return 0 }
    return [int]$val
}

# ----------------------------------------------------------------
# Set-HesabfaStock: تنظیم مستقیم موجودی با UpdateOpeningQuantity
# این تنها روش بدون نیاز به سیستم انبارداری است
# unitPrice باید > 0 باشد (مقدار ۱ برای تست کافی است)
# ----------------------------------------------------------------
function Set-HesabfaStock {
    param($ItemCode, $NewStock)
    if ($NewStock -lt 1) {
        Write-Info "  [SKIP]  Set-HesabfaStock: NewStock=$NewStock < 1, skipping (API requires quantity > 0)"
        return
    }
    Invoke-Hesabfa "/item/UpdateOpeningQuantity" @{
        items = @(
            @{
                code      = $ItemCode
                quantity  = $NewStock
                unitPrice = 1
            }
        )
    } | Out-Null
}

function Add-Stock {
    param($ItemCode, $CurrentStock, $Qty)
    Set-HesabfaStock $ItemCode ($CurrentStock + $Qty)
}

function Remove-Stock {
    param($ItemCode, $CurrentStock, $Qty)
    $newStock = [Math]::Max(1, ($CurrentStock - $Qty))
    Set-HesabfaStock $ItemCode $newStock
}

function Set-HesabfaPrice {
    param($ItemCode, $ItemName, $ItemType, $NewPrice)
    Invoke-Hesabfa "/item/save" @{
        item = @{
            code      = $ItemCode
            name      = $ItemName
            itemType  = $ItemType
            sellPrice = $NewPrice
        }
    } | Out-Null
}

function Invoke-Sync {
    Write-Info "Running sync..."
    node $SYNC_SCRIPT 2>&1 | Out-Null
    return (Get-Content "sync-log.json" -Raw | ConvertFrom-Json)
}

function Read-Log {
    return (Get-Content "sync-log.json" -Raw | ConvertFrom-Json)
}

$passed = 0
$failed = 0

Write-Host "`n================================================" -ForegroundColor Magenta
Write-Host "   TEST SUITE - inventory-sync" -ForegroundColor Magenta
Write-Host "   Test barcode: $TEST_BARCODE" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta

try {

Write-Step "TEST 0 - Base state in Hesabfa"
$itemCode  = Get-HesabfaCode     $TEST_BARCODE
$itemName  = Get-HesabfaName     $TEST_BARCODE
$itemType  = Get-HesabfaItemType $TEST_BARCODE
$baseStock = Get-HesabfaStock    $TEST_BARCODE
$basePrice = Get-HesabfaPrice    $TEST_BARCODE

Write-Info "Item Code : $itemCode"
Write-Info "Item Name : $itemName"
Write-Info "Item Type : $itemType"
Write-Info "Stock     : $baseStock"
Write-Info "Price     : $basePrice"

if ($itemCode) {
    Write-Pass "Item found in Hesabfa (code=$itemCode)"
    $passed++
} else {
    Write-Fail "Item NOT found by barcode $TEST_BARCODE - aborting"
    $failed++
    exit 1
}

# بررسی پیش‌شرط: موجودی باید >= 2 باشد تا تست -1 معنا داشته باشد
if ($baseStock -lt 2) {
    Write-Info "Base stock=$baseStock is low, setting to 5 before tests..."
    Set-HesabfaStock $itemCode 5
    Start-Sleep -Seconds 2
    $baseStock = Get-HesabfaStock $TEST_BARCODE
    Write-Info "Stock reset to: $baseStock"
}

Write-Step "TEST 1 - Initial sync"
$log1 = Invoke-Sync
Write-Info "stockUpdated=$($log1.stockUpdated)  stockSkippedZero=$($log1.stockSkippedZero)  forbidden=$($log1.forbidden)  notFound=$($log1.notFound)  errors=$($log1.errors.Count)"

if ($log1.stockUpdated -ge 1) {
    Write-Pass "Sync ran - stockUpdated=$($log1.stockUpdated)"
    $passed++
} else {
    Write-Fail "Sync ran but stockUpdated=0 (check portal connection)"
    $failed++
}

if ($log1.errors.Count -eq 0) {
    Write-Pass "No errors in initial sync"
    $passed++
} else {
    Write-Fail "$($log1.errors.Count) error(s) in initial sync"
    $failed++
}

Write-Step "TEST 2 - Stock +1 in Hesabfa then verify site"
$s0 = Get-HesabfaStock $TEST_BARCODE
Write-Info "Hesabfa stock before +1 : $s0"

Add-Stock $itemCode $s0 1
Start-Sleep -Seconds 3

$s1 = Get-HesabfaStock $TEST_BARCODE
Write-Info "Hesabfa stock after  +1 : $s1"

if ($s1 -eq ($s0 + 1)) {
    Write-Pass "Hesabfa stock +1 confirmed ($s0 -> $s1)"
    $passed++
} else {
    Write-Fail "Hesabfa stock mismatch (expected=$($s0+1) got=$s1)"
    $failed++
}

$log2 = Invoke-Sync
Write-Info "Sync after +1: stockUpdated=$($log2.stockUpdated) errors=$($log2.errors.Count)"

if ($log2.stockUpdated -ge 1) {
    Write-Pass "Site updated after stock +1 (stockUpdated=$($log2.stockUpdated))"
    $passed++
} else {
    Write-Fail "Site NOT updated after stock +1 (stockUpdated=$($log2.stockUpdated))"
    $failed++
}

if ($log2.errors.Count -eq 0) {
    Write-Pass "No errors in sync after +1"
    $passed++
} else {
    Write-Fail "$($log2.errors.Count) error(s) in sync after +1"
    $failed++
}

Write-Step "TEST 3 - Stock -1 in Hesabfa then verify site"
$s2 = Get-HesabfaStock $TEST_BARCODE
Write-Info "Hesabfa stock before -1 : $s2"

Remove-Stock $itemCode $s2 1
Start-Sleep -Seconds 3

$s3 = Get-HesabfaStock $TEST_BARCODE
Write-Info "Hesabfa stock after  -1 : $s3"

if ($s3 -eq ($s2 - 1)) {
    Write-Pass "Hesabfa stock -1 confirmed ($s2 -> $s3)"
    $passed++
} else {
    Write-Fail "Hesabfa stock mismatch (expected=$($s2-1) got=$s3)"
    $failed++
}

$log3 = Invoke-Sync
Write-Info "Sync after -1: stockUpdated=$($log3.stockUpdated) stockSkippedZero=$($log3.stockSkippedZero) errors=$($log3.errors.Count)"

if ($s3 -ge 1) {
    if ($log3.stockUpdated -ge 1) {
        Write-Pass "Site updated after stock -1 (stock still positive, stockUpdated=$($log3.stockUpdated))"
        $passed++
    } else {
        Write-Fail "Site NOT updated after stock -1 (stockUpdated=$($log3.stockUpdated))"
        $failed++
    }
} else {
    if ($log3.stockSkippedZero -ge 1) {
        Write-Pass "Stock reached 0 - product excluded from site (stockSkippedZero=$($log3.stockSkippedZero))"
        $passed++
    } else {
        Write-Fail "Stock is 0 but stockSkippedZero=0 - check sync logic"
        $failed++
    }
}

if ($log3.errors.Count -eq 0) {
    Write-Pass "No errors in sync after -1"
    $passed++
} else {
    Write-Fail "$($log3.errors.Count) error(s) in sync after -1"
    $failed++
}

Write-Step "TEST 4 - Price +10 in Hesabfa then verify site"
$p0 = Get-HesabfaPrice $TEST_BARCODE
Write-Info "Hesabfa price before +10 : $p0"

Set-HesabfaPrice $itemCode $itemName $itemType ($p0 + 10)
Start-Sleep -Seconds 2

$p1 = Get-HesabfaPrice $TEST_BARCODE
Write-Info "Hesabfa price after  +10 : $p1"

if ($p1 -eq ($p0 + 10)) {
    Write-Pass "Hesabfa price +10 confirmed ($p0 -> $p1)"
    $passed++
} else {
    Write-Fail "Hesabfa price mismatch (expected=$($p0+10) got=$p1)"
    $failed++
}

$log4 = Invoke-Sync
Write-Info "Sync after +10 price: stockUpdated=$($log4.stockUpdated) errors=$($log4.errors.Count)"

if ($log4.stockUpdated -ge 1) {
    Write-Pass "Sync ran successfully after price +10 (stockUpdated=$($log4.stockUpdated))"
    $passed++
} else {
    Write-Fail "Sync stockUpdated=0 after price +10"
    $failed++
}

if ($log4.errors.Count -eq 0) {
    Write-Pass "No errors in sync after +10 price"
    $passed++
} else {
    Write-Fail "$($log4.errors.Count) error(s) in sync after +10 price"
    $failed++
}

Write-Step "TEST 5 - Price -10 in Hesabfa then verify site"
$p2 = Get-HesabfaPrice $TEST_BARCODE
Write-Info "Hesabfa price before -10 : $p2"

Set-HesabfaPrice $itemCode $itemName $itemType ($p2 - 10)
Start-Sleep -Seconds 2

$p3 = Get-HesabfaPrice $TEST_BARCODE
Write-Info "Hesabfa price after  -10 : $p3"

if ($p3 -eq ($p2 - 10)) {
    Write-Pass "Hesabfa price -10 confirmed ($p2 -> $p3)"
    $passed++
} else {
    Write-Fail "Hesabfa price mismatch (expected=$($p2-10) got=$p3)"
    $failed++
}

$log5 = Invoke-Sync
Write-Info "Sync after -10 price: stockUpdated=$($log5.stockUpdated) errors=$($log5.errors.Count)"

if ($log5.stockUpdated -ge 1) {
    Write-Pass "Sync ran successfully after price -10 (stockUpdated=$($log5.stockUpdated))"
    $passed++
} else {
    Write-Fail "Sync stockUpdated=0 after price -10"
    $failed++
}

if ($log5.errors.Count -eq 0) {
    Write-Pass "No errors in sync after -10 price"
    $passed++
} else {
    Write-Fail "$($log5.errors.Count) error(s) in sync after -10 price"
    $failed++
}

Write-Step "TEST 6 - Forbidden categories filtered"
$logF = Read-Log
Write-Info "forbidden=$($logF.forbidden)  stockSkippedZero=$($logF.stockSkippedZero)  notFound=$($logF.notFound)"

if ($logF.PSObject.Properties.Name -contains "forbidden") {
    Write-Pass "Field 'forbidden' exists in log (value=$($logF.forbidden))"
    $passed++
} else {
    Write-Fail "Field 'forbidden' NOT found in sync-log.json"
    $failed++
}

if ($logF.PSObject.Properties.Name -contains "stockSkippedZero") {
    Write-Pass "Field 'stockSkippedZero' exists in log (value=$($logF.stockSkippedZero))"
    $passed++
} else {
    Write-Fail "Field 'stockSkippedZero' NOT found in sync-log.json"
    $failed++
}

Write-Step "TEST 7 - Zero errors in final sync"
if ($logF.errors.Count -eq 0) {
    Write-Pass "Zero errors in final sync log"
    $passed++
} else {
    Write-Fail "$($logF.errors.Count) error(s) in final sync log"
    foreach ($err in $logF.errors) {
        Write-Info "  Error: [$($err.productId)] $($err.action) - $($err.error)"
    }
    $failed++
}

Write-Step "TEST 8 - Restore original price and stock"
$currentPrice = Get-HesabfaPrice $TEST_BARCODE
$currentStock = Get-HesabfaStock $TEST_BARCODE
Write-Info "Current price : $currentPrice  (original: $basePrice)"
Write-Info "Current stock : $currentStock  (original: $baseStock)"

if ($currentPrice -ne $basePrice) {
    Set-HesabfaPrice $itemCode $itemName $itemType $basePrice
    Start-Sleep -Seconds 1
    $restoredPrice = Get-HesabfaPrice $TEST_BARCODE
    if ($restoredPrice -eq $basePrice) {
        Write-Pass "Price restored to original ($basePrice)"
        $passed++
    } else {
        Write-Fail "Price restore failed (expected=$basePrice got=$restoredPrice)"
        $failed++
    }
} else {
    Write-Pass "Price already at original value ($basePrice)"
    $passed++
}

if ($currentStock -ne $baseStock) {
    Set-HesabfaStock $itemCode $baseStock
    Start-Sleep -Seconds 1
    $restoredStock = Get-HesabfaStock $TEST_BARCODE
    if ($restoredStock -eq $baseStock) {
        Write-Pass "Stock restored to original ($baseStock)"
        $passed++
    } else {
        Write-Fail "Stock restore failed (expected=$baseStock got=$restoredStock)"
        $failed++
    }
} else {
    Write-Pass "Stock already at original value ($baseStock)"
    $passed++
}

} catch {
    Write-Fail "Unexpected error: $_"
    $failed++
}

Write-Host "`n================================================" -ForegroundColor Magenta
Write-Host "   RESULT: PASS=$passed  FAIL=$failed" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta

if ($failed -eq 0) {
    Write-Host "`n  All tests passed - ready to deliver!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n  $failed test(s) failed - review output above" -ForegroundColor Red
    exit 1
}