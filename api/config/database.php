<?php
/**
 * PDO MySQL connection — singleton, equivalent to the single shared
 * PrismaClient instance used throughout the Node backend.
 */

class Database
{
    private static ?PDO $instance = null;

    public static function getInstance(): PDO
    {
        if (self::$instance === null) {
            $dsn = sprintf(
                'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
                DB_HOST,
                DB_PORT,
                DB_NAME
            );
            try {
                self::$instance = new PDO($dsn, DB_USER, DB_PASS, [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]);
                // MySQL's NOW()/CURRENT_TIMESTAMP (used by createdAt/updatedAt column
                // defaults) follow the DB server's own time zone, which is separate from
                // PHP's date_default_timezone_set() in config.php. Pin this session to
                // IST so those columns stay consistent with app-generated timestamps.
                // Numeric offset (not 'Asia/Kolkata') because most shared-hosting MySQL
                // installs don't have the named time zone tables loaded.
                self::$instance->exec("SET time_zone = '+05:30'");
            } catch (PDOException $e) {
                http_response_code(500);
                header('Content-Type: application/json');
                echo json_encode([
                    'success' => false,
                    'message' => 'Database connection failed.',
                    ...(APP_ENV === 'development' ? ['error' => $e->getMessage()] : []),
                ]);
                exit;
            }
        }
        return self::$instance;
    }
}

/** Convenience shortcut used everywhere instead of Database::getInstance() */
function db(): PDO
{
    return Database::getInstance();
}
