<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function normalizeIdentifier(string $value, string $fallback): string
{
    return preg_match('/^[a-zA-Z0-9_]+$/', $value) ? $value : $fallback;
}

function normalizeDateValue(?string $value): ?string
{
    if (!$value) return null;
    $value = trim($value);
    if ($value === '') return null;
    $ts = strtotime($value);
    if ($ts === false) return null;
    return date('Y-m-d', $ts);
}

function normalizeTimeValue(?string $value): ?string
{
    if (!$value) return null;
    $value = trim($value);
    if ($value === '') return null;

    if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $value)) {
        return null;
    }

    if (strlen($value) === 5) {
        $value .= ':00';
    }
    return $value;
}

function minTime(?string $left, ?string $right): ?string
{
    if (!$left) return $right;
    if (!$right) return $left;
    return strcmp($left, $right) <= 0 ? $left : $right;
}

function maxTime(?string $left, ?string $right): ?string
{
    if (!$left) return $right;
    if (!$right) return $left;
    return strcmp($left, $right) >= 0 ? $left : $right;
}

$inputRaw = file_get_contents('php://input');
$input = json_decode($inputRaw ?: '', true);
if (!is_array($input)) {
    respond(400, ['ok' => false, 'error' => 'Invalid JSON payload']);
}

$dbHost = (string)($input['db_host'] ?? getenv('DB_HOST') ?: '');
$dbName = (string)($input['db_name'] ?? getenv('DB_NAME') ?: '');
$dbUser = (string)($input['db_user'] ?? getenv('DB_USER') ?: '');
$dbPass = (string)($input['db_pass'] ?? getenv('DB_PASS') ?: '');
$table = normalizeIdentifier((string)($input['table'] ?? 'time_hr'), 'time_hr');
$records = $input['data'] ?? [];

if ($dbHost === '' || $dbName === '' || $dbUser === '') {
    respond(400, ['ok' => false, 'error' => 'Database credentials are missing']);
}
if (!is_array($records)) {
    respond(400, ['ok' => false, 'error' => 'Field "data" must be an array']);
}

try {
    $pdo = new PDO(
        "mysql:host={$dbHost};dbname={$dbName};charset=utf8mb4",
        $dbUser,
        $dbPass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );

    $pdo->beginTransaction();

    $selectStmt = $pdo->prepare("SELECT id, `start`, `end` FROM `{$table}` WHERE iduser = :iduser AND `date` = :date LIMIT 1");
    $insertStmt = $pdo->prepare("INSERT INTO `{$table}` (iduser, `date`, `start`, `end`) VALUES (:iduser, :date, :start, :end)");
    $updateStmt = $pdo->prepare("UPDATE `{$table}` SET `start` = :start, `end` = :end WHERE id = :id");

    $inserted = 0;
    $updated = 0;
    $skipped = 0;

    foreach ($records as $row) {
        if (!is_array($row)) {
            $skipped++;
            continue;
        }

        $iduser = trim((string)($row['iduser'] ?? ''));
        $dateValue = normalizeDateValue((string)($row['date'] ?? ($row['data'] ?? '')));
        $startValue = normalizeTimeValue(isset($row['start']) ? (string)$row['start'] : null);
        $endValue = normalizeTimeValue(isset($row['end']) ? (string)$row['end'] : null);

        if ($iduser === '' || $dateValue === null) {
            $skipped++;
            continue;
        }

        $selectStmt->execute([':iduser' => $iduser, ':date' => $dateValue]);
        $existing = $selectStmt->fetch();

        if ($existing) {
            $newStart = minTime($existing['start'], $startValue);
            $newEnd = maxTime($existing['end'], $endValue);
            $updateStmt->execute([
                ':id' => $existing['id'],
                ':start' => $newStart,
                ':end' => $newEnd,
            ]);
            $updated++;
        } else {
            $insertStmt->execute([
                ':iduser' => $iduser,
                ':date' => $dateValue,
                ':start' => $startValue,
                ':end' => $endValue,
            ]);
            $inserted++;
        }
    }

    $pdo->commit();
    respond(200, [
        'ok' => true,
        'inserted' => $inserted,
        'updated' => $updated,
        'skipped' => $skipped,
    ]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    respond(500, ['ok' => false, 'error' => $e->getMessage()]);
}
