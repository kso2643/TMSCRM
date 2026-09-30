<?php
if (!function_exists('sendSuccess')) {
    function sendSuccess($data = [], string $message = 'Success', int $statusCode = 200): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode(['success' => true, 'message' => $message, 'data' => $data], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

if (!function_exists('sendError')) {
    function sendError(string $message = 'Error', int $statusCode = 400, $errors = null): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        $payload = ['success' => false, 'message' => $message];
        if ($errors !== null) $payload['errors'] = $errors;
        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
        exit;
    }
}

if (!function_exists('sendPaginated')) {
    function sendPaginated(array $items, int $total, $page, $limit, string $message = 'Success'): void
    {
        $page = (int) $page;
        $limit = max(1, (int) $limit);
        http_response_code(200);
        header('Content-Type: application/json');
        echo json_encode([
            'success' => true,
            'message' => $message,
            'data' => [
                'items'      => $items,
                'total'      => $total,
                'page'       => $page,
                'limit'      => $limit,
                'totalPages' => (int) ceil($total / $limit),
            ],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}
