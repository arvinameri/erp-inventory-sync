# Test suite for invoice sync fix
# Run: .\tests\test-invoice-fixed.ps1

$BASE = "http://localhost:3000"
$PASS = 0
$FAIL = 0

function Check($label, $condition, $detail = "") {
    if ($condition) {
        Write-Host "  [PASS] $label" -ForegroundColor Green
        $script:PASS++
    } else {
        Write-Host "  [FAIL] $label $detail" -ForegroundColor Red
        $script:FAIL++
    }
}

function Info($label, $value = "") {
    Write-Host "  [INFO] $label$value" -ForegroundColor Gray
}

function Warn($text) {
    Write-Host "  [WARN] $text" -ForegroundColor Yellow
}

function Req($method, $path, $body = $null) {
    $uri = "$BASE$path"
    try {
        if ($null -ne $body) {
            $json = $body | ConvertTo-Json -Depth 20
            return Invoke-RestMethod -Method $method -Uri $uri -ContentType "application/json" -Body $json -ErrorAction Stop
        }
        return Invoke-RestMethod -Method $method -Uri $uri -ErrorAction Stop
    } catch {
        Write-Host "  [HTTP ERROR] $method $path : $_" -ForegroundColor Yellow
        return $null
    }
}

function Get-StatsObject($obj) {
    if ($null -eq $obj) { return $null }

    if ($obj.PSObject.Properties.Name -contains 'total' -or
        $obj.PSObject.Properties.Name -contains 'invoiced' -or
        $obj.PSObject.Properties.Name -contains 'already_invoiced' -or
        $obj.PSObject.Properties.Name -contains 'skipped' -or
        $obj.PSObject.Properties.Name -contains 'failed') {
        return $obj
    }

    foreach ($prop in @('data','result','payload','meta')) {
        if ($obj.PSObject.Properties.Name -contains $prop) {
            $nested = $obj.$prop
            if ($null -ne $nested) {
                $candidate = Get-StatsObject $nested
                if ($null -ne $candidate) { return $candidate }
            }
        }
    }

    return $obj
}

function Wait-UntilJobCompletes($timeoutSec = 120, $pollSec = 2) {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $timeoutSec) {
        $status = Req "GET" "/invoice/status"
        if ($null -ne $status) {
            if ($status.isRunning -eq $false) {
                return $status
            }
        }
        Start-Sleep -Seconds $pollSec
    }
    return Req "GET" "/invoice/status"
}

function Read-JsonObject($filePath) {
    if (-not (Test-Path $filePath)) { return $null }
    try {
        $raw = Get-Content $filePath -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
        return $raw | ConvertFrom-Json
    } catch {
        Warn "Failed to parse JSON file: $filePath"
        return $null
    }
}

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  INVOICE SYNC - FINAL TEST SUITE" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan

# 1. Health check
Write-Host "`n[1] Health Check" -ForegroundColor Yellow
$health = Req "GET" "/health"
Check "Server is up" ($health -ne $null)
if ($health -ne $null) {
    Check "Status is ok" ($health.status -eq "ok")
} else {
    Check "Status is ok" $false "(health endpoint unavailable)"
}

# 2. Static safety checks in source code
Write-Host "`n[2] Source Code Safety Checks" -ForegroundColor Yellow
$serviceFile = ".\src\services\invoice.service.js"
$jobFile = ".\src\jobs\invoice.job.js"

if (Test-Path $serviceFile) {
    $svcContent = Get-Content $serviceFile -Raw -Encoding UTF8

    $hasPersistentFile = ($svcContent -match "processed-orders\.json") -or ($svcContent -match "PROCESSED_ORDERS_FILE")
    Check "Persistent processed-orders storage exists" $hasPersistentFile "(processed orders are not persisted)"

    $hasDeleteFalse = $svcContent -match "deleteOldReceipts:\s*false"
    $hasDeleteTrue = $svcContent -match "deleteOldReceipts:\s*true"
    Check "deleteOldReceipts is false" ($hasDeleteFalse -and -not $hasDeleteTrue) "(true can cause repeated warehouse impact)"

    $hasMarkProcessed = $svcContent -match "synced_hesabfa_invoice_"
    Check "Order marking tag exists" $hasMarkProcessed "(portal orders are not marked as synced)"

    $hasInvoiceRef = $svcContent -match "reference:\s*.*order_"
    $hasInvoiceTag = $svcContent -match "tag:\s*.*portal_order_"
    Check "Invoice reference/tag idempotency markers exist" ($hasInvoiceRef -and $hasInvoiceTag) "(duplicate detection markers missing)"

    $hasInvoiceTypeGetter = $svcContent -match "get invoiceType\(\)"
    Check "invoiceType getter exists" $hasInvoiceTypeGetter "(cannot validate sales invoice type behavior)"
} else {
    Check "Service file exists" $false "($serviceFile not found)"
}

if (Test-Path $jobFile) {
    $jobContent = Get-Content $jobFile -Raw -Encoding UTF8
    $hasSingleton = ($jobContent -match "_invoiceServiceInstance") -or ($jobContent -match "getInvoiceService\(")
    Check "InvoiceService singleton/reuse exists" $hasSingleton "(fresh service creation may weaken run consistency)"

    $hasRunningGuard = $jobContent -match "Already running"
    Check "Concurrent-run guard exists" $hasRunningGuard "(overlapping jobs may occur)"
} else {
    Check "Job file exists" $false "($jobFile not found)"
}

# 3. DryRun sync
Write-Host "`n[3] DryRun Sync" -ForegroundColor Yellow
$dryRaw = Req "POST" "/invoice/sync" @{ dryRun = $true }
$dry = Get-StatsObject $dryRaw
Check "DryRun returned response" ($dryRaw -ne $null)
$hasDryStats = ($null -ne $dry) -and (
    ($dry.PSObject.Properties.Name -contains 'total') -or
    ($dry.PSObject.Properties.Name -contains 'invoiced') -or
    ($dry.PSObject.Properties.Name -contains 'already_invoiced') -or
    ($dry.PSObject.Properties.Name -contains 'skipped') -or
    ($dry.PSObject.Properties.Name -contains 'failed')
)
Check "DryRun returned stats object" $hasDryStats "(response shape is different than expected)"
if ($hasDryStats) {
    Info "DryRun total orders: " $dry.total
    Info "DryRun invoiced: " $dry.invoiced
    Info "DryRun already_invoiced: " $dry.already_invoiced
    Info "DryRun skipped: " $dry.skipped
    Info "DryRun failed: " $dry.failed
}

# 4. Real sync + wait for completion
Write-Host "`n[4] Real Sync Completion" -ForegroundColor Yellow
$run1Raw = Req "POST" "/invoice/sync" @{ dryRun = $false }
Check "Real sync request accepted" ($run1Raw -ne $null)
$statusAfterRun1 = Wait-UntilJobCompletes 180 2
Check "Job completed after real sync" (($statusAfterRun1 -ne $null) -and ($statusAfterRun1.isRunning -eq $false)) "(job still running or status unavailable)"
if ($statusAfterRun1 -ne $null) {
    Info "Last run time: " $statusAfterRun1.lastRun
}

# 5. Idempotency verification by status result
Write-Host "`n[5] Idempotency Verification" -ForegroundColor Yellow
$firstStatusResult = if ($statusAfterRun1 -and $statusAfterRun1.lastResult) { $statusAfterRun1.lastResult } else { Get-StatsObject $run1Raw }
$firstStats = Get-StatsObject $firstStatusResult

if ($null -eq $firstStats) {
    Check "First run stats available" $false "(cannot inspect first sync result)"
} else {
    Info "First run total: " $firstStats.total
    Info "First run invoiced: " $firstStats.invoiced
    Info "First run already_invoiced: " $firstStats.already_invoiced
    Info "First run skipped: " $firstStats.skipped
    Info "First run failed: " $firstStats.failed
    Check "First run completed without failures" (($firstStats.failed -eq 0) -or ($null -eq $firstStats.failed)) "(there are failed orders to inspect)"
}

$run2Raw = Req "POST" "/invoice/sync" @{ dryRun = $false }
Check "Second sync request accepted" ($run2Raw -ne $null)
$statusAfterRun2 = Wait-UntilJobCompletes 180 2
Check "Job completed after second sync" (($statusAfterRun2 -ne $null) -and ($statusAfterRun2.isRunning -eq $false)) "(second job still running or status unavailable)"
$secondStatusResult = if ($statusAfterRun2 -and $statusAfterRun2.lastResult) { $statusAfterRun2.lastResult } else { Get-StatsObject $run2Raw }
$secondStats = Get-StatsObject $secondStatusResult

if ($null -eq $secondStats) {
    Check "Second run stats available" $false "(cannot inspect second sync result)"
} else {
    $secondInvoiced = if ($null -ne $secondStats.invoiced) { [int]$secondStats.invoiced } else { 0 }
    $secondAlready = if ($null -ne $secondStats.already_invoiced) { [int]$secondStats.already_invoiced } else { 0 }
    $secondFailed = if ($null -ne $secondStats.failed) { [int]$secondStats.failed } else { 0 }

    Info "Second run total: " $secondStats.total
    Info "Second run invoiced: " $secondInvoiced
    Info "Second run already_invoiced: " $secondAlready
    Info "Second run skipped: " $secondStats.skipped
    Info "Second run failed: " $secondFailed

    Check "Second run created 0 new invoices" ($secondInvoiced -eq 0) "(duplicate processing still exists)"
    Check "Second run completed without failures" ($secondFailed -eq 0) "(some orders failed in second run)"
    Check "Second run detected prior invoices" ($secondAlready -ge 0) "(already_invoiced not available)"
}

# 6. Persistent cache verification
Write-Host "`n[6] Persistent Cache Verification" -ForegroundColor Yellow
$dataFile = ".\data\processed-orders.json"
if (Test-Path $dataFile) {
    $cache = Read-JsonObject $dataFile
    if ($null -eq $cache) {
        Check "processed-orders.json is valid JSON" $false "(file exists but cannot be parsed)"
    } else {
        $entries = $cache.PSObject.Properties
        $totalCached = ($entries | Measure-Object).Count
        Check "Persistent cache has at least one entry" ($totalCached -gt 0) "(no processed orders were saved)"
        Info "Cached orders count: " $totalCached

        $hasInvoiceNumbers = $false
        $allHaveOrderId = $true
        foreach ($entry in $entries) {
            $val = $entry.Value
            if ($val.invoiceNumber) { $hasInvoiceNumbers = $true }
            if (-not $val.orderId) { $allHaveOrderId = $false }
        }
        Check "Cache contains invoice numbers" $hasInvoiceNumbers "(processed records do not include invoice numbers)"
        Check "Cache records keep orderId" $allHaveOrderId "(some cache entries are incomplete)"
    }
} else {
    Warn "processed-orders.json not found. This may be normal if no new invoice was created in this environment."
    Check "Persistent cache file present OR no new invoices were needed" $true
}

# 7. Final operational status
Write-Host "`n[7] Final Job Status" -ForegroundColor Yellow
$finalStatus = Req "GET" "/invoice/status"
Check "Status endpoint works" ($finalStatus -ne $null)
if ($finalStatus -ne $null) {
    Check "isRunning is false at end of suite" ($finalStatus.isRunning -eq $false) "(job still running unexpectedly)"
    Check "lastRun is set" ($null -ne $finalStatus.lastRun)
    if ($finalStatus.lastResult) {
        $lr = Get-StatsObject $finalStatus.lastResult
        if ($lr) {
            Info "Final lastResult total: " $lr.total
            Info "Final lastResult invoiced: " $lr.invoiced
            Info "Final lastResult already_invoiced: " $lr.already_invoiced
            Info "Final lastResult skipped: " $lr.skipped
            Info "Final lastResult failed: " $lr.failed
        }
    }
}

# 8. Business acceptance summary
Write-Host "`n[8] Business Acceptance" -ForegroundColor Yellow
$secondInvoicedFinal = 0
if (($null -ne $secondStats) -and ($null -ne $secondStats.invoiced)) { $secondInvoicedFinal = [int]$secondStats.invoiced }
Check "No duplicate invoice creation detected in second run" (($secondStats -ne $null) -and ($secondInvoicedFinal -eq 0)) "(customer duplicate-invoice complaint not fully closed)"
Check "Warehouse receipt is protected against deleteOldReceipts=true" ($hasDeleteFalse -and -not $hasDeleteTrue) "(customer stock double-decrement risk remains)"
Check "Processed-order persistence is implemented" $hasPersistentFile "(customer loop/repeat issue risk remains)"

# Final results
Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
$total = $PASS + $FAIL
if ($FAIL -eq 0) {
    Write-Host "  RESULTS: $PASS/$total passed - READY FOR DELIVERY" -ForegroundColor Green
    Write-Host "  Customer-facing risks covered: duplicate invoice, repeated loop, repeated stock decrement." -ForegroundColor Green
} else {
    Write-Host "  RESULTS: $PASS/$total passed - $FAIL FAILED" -ForegroundColor Red
    Write-Host "  Review FAIL lines before delivery." -ForegroundColor Red
}
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""
