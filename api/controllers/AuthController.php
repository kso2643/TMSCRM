<?php
class AuthController
{
    private const MAX_FAILED = 5;

    // POST /api/auth/login
    public function login(): void
    {
        $body = request_body();
        $email    = strtolower(trim($body['email'] ?? ''));
        $password = $body['password'] ?? '';

        if (!$email || !$password) sendError('Email and password are required.', 400);

        $stmt = db()->prepare('SELECT * FROM `User` WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        if (!$user)                sendError('Invalid email or password.', 401);
        if (!(bool)$user['isActive']) sendError('Account deactivated. Contact your admin.', 403);
        if ((bool)$user['isLocked'])  sendError('Account locked due to too many failed attempts. Contact your admin.', 403);

        if (!password_verify($password, $user['password'])) {
            $newCount    = (int)$user['failedLoginCount'] + 1;
            $shouldLock  = $newCount >= self::MAX_FAILED;
            db()->prepare('UPDATE `User` SET failedLoginCount=?, isLocked=? WHERE id=?')
               ->execute([$newCount, (int)$shouldLock, $user['id']]);
            if ($shouldLock) sendError('Account locked after ' . self::MAX_FAILED . ' failed attempts. Contact your admin.', 403);
            $remaining = self::MAX_FAILED - $newCount;
            sendError("Invalid email or password. {$remaining} attempt(s) remaining.", 401);
        }

        db()->prepare('UPDATE `User` SET failedLoginCount=0, lastLoginAt=? WHERE id=?')
           ->execute([now_sql(), $user['id']]);

        log_activity($user['id'], 'LOGIN');

        $token = JWT::sign(
            ['id' => $user['id'], 'email' => $user['email'], 'role' => $user['role']],
            JWT_SECRET,
            JWT_EXPIRES_IN
        );

        sendSuccess([
            'token' => $token,
            'user'  => [
                'id'         => $user['id'],
                'name'       => $user['name'],
                'email'      => $user['email'],
                'role'       => $user['role'],
                'department' => $user['department'],
                'avatar'     => $user['avatar'],
            ],
        ], 'Login successful');
    }

    // POST /api/auth/logout
    public function logout(): void
    {
        $user = authenticate();
        log_activity($user['id'], 'LOGOUT');
        sendSuccess([], 'Logged out successfully');
    }

    // GET /api/auth/me
    public function me(): void
    {
        $user = authenticate();
        $stmt = db()->prepare(
            'SELECT id, name, email, role, phone, department, avatar, lastLoginAt, sessionTimeout, twoFactorEnabled
             FROM `User` WHERE id = ? LIMIT 1'
        );
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch();
        if (!$row) sendError('User not found.', 404);
        $row['twoFactorEnabled'] = (bool)$row['twoFactorEnabled'];
        sendSuccess(['user' => $row]);
    }

    // PUT /api/auth/change-password
    public function changePassword(): void
    {
        $user = authenticate();
        $body = request_body();
        $current = $body['currentPassword'] ?? '';
        $new_pw  = $body['newPassword'] ?? '';

        if (!$current || !$new_pw)   sendError('Both current and new password are required.', 400);
        if (strlen($new_pw) < 6)     sendError('New password must be at least 6 characters.', 400);

        $stmt = db()->prepare('SELECT password FROM `User` WHERE id=? LIMIT 1');
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch();
        if (!password_verify($current, $row['password'])) sendError('Current password is incorrect.', 401);

        $hash = password_hash($new_pw, PASSWORD_BCRYPT, ['cost' => 12]);
        db()->prepare('UPDATE `User` SET password=? WHERE id=?')->execute([$hash, $user['id']]);
        log_activity($user['id'], 'PASSWORD_CHANGED');
        sendSuccess([], 'Password changed successfully');
    }

    // PUT /api/auth/profile
    public function updateProfile(): void
    {
        $user = authenticate();
        $body = request_body();
        $name  = isset($body['name'])  ? trim($body['name'])  : null;
        $phone = isset($body['phone']) ? trim($body['phone']) : null;

        $sets = []; $params = [];
        if ($name  !== null && $name !== '')    { $sets[] = 'name=?';  $params[] = $name; }
        if (array_key_exists('phone', $body))   { $sets[] = 'phone=?'; $params[] = ($phone === '' ? null : $phone); }
        if (!empty($sets)) {
            $params[] = $user['id'];
            db()->prepare('UPDATE `User` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        }

        $stmt = db()->prepare('SELECT id,name,email,role,phone,department,avatar FROM `User` WHERE id=? LIMIT 1');
        $stmt->execute([$user['id']]);
        sendSuccess(['user' => $stmt->fetch()], 'Profile updated');
    }
}
