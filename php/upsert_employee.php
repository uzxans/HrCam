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

$raw = file_get_contents('php://input');
$input = json_decode($raw ?: '', true);
if (!is_array($input)) {
    respond(400, ['ok' => false, 'error' => 'Invalid JSON payload']);
}

$dbHost = (string)($input['db_host'] ?? getenv('DB_HOST') ?: '');
$dbName = (string)($input['db_name'] ?? getenv('DB_NAME') ?: '');
$dbUser = (string)($input['db_user'] ?? getenv('DB_USER') ?: '');
$dbPass = (string)($input['db_pass'] ?? getenv('DB_PASS') ?: '');
$table = normalizeIdentifier((string)($input['db_table'] ?? 'hrapp'), 'hrapp');

if ($dbHost === '' || $dbName === '' || $dbUser === '') {
    respond(400, ['ok' => false, 'error' => 'Database credentials are missing']);
}

$employees = $input['employees'] ?? null;
if (!is_array($employees)) {
    // Also support sending one employee directly in root payload.
    $singleId = $input['id'] ?? null;
    if ($singleId !== null) {
        $employees = [$input];
    } else {
        respond(400, ['ok' => false, 'error' => 'Field "employees" must be an array']);
    }
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

    $selectStmt = $pdo->prepare("SELECT id FROM `{$table}` WHERE id = :id LIMIT 1");
    $insertStmt = $pdo->prepare("
        INSERT INTO `{$table}` (`id`, `full_name`, `photo`, `status`, `object`)
        VALUES (:id, :full_name, :photo, :status, :object)
    ");
    $updateStmt = $pdo->prepare("
        UPDATE `{$table}`
        SET `full_name` = :full_name,
            `photo` = :photo,
            `status` = :status,
            `object` = :object
        WHERE `id` = :id
    ");

    $inserted = 0;
    $updated = 0;
    $skipped = 0;

    foreach ($employees as $employee) {
        if (!is_array($employee)) {
            $skipped++;
            continue;
        }

        $id = trim((string)($employee['id'] ?? ''));
        if ($id === '') {
            $skipped++;
            continue;
        }

        $fullName = (string)($employee['full_name'] ?? $employee['name'] ?? 'Без имени');
        $photo = (string)($employee['photo'] ?? '');
        $status = (int)($employee['status'] ?? 100);
        $object = (string)($employee['object'] ?? $employee['objectId'] ?? '');

        $selectStmt->execute([':id' => $id]);
        $exists = $selectStmt->fetch();

        $params = [
            ':id' => $id,
            ':full_name' => $fullName,
            ':photo' => $photo,
            ':status' => $status,
            ':object' => $object,
        ];

        if ($exists) {
            $updateStmt->execute($params);
            $updated++;
        } else {
            $insertStmt->execute($params);
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
