<?php
class UserController
{
    private const ROLES = ['SUPER_ADMIN','ADMIN','MANAGER','SALES_ENGINEER','SALES'];

    private const SAFE_COLS = 'id,name,email,role,phone,department,avatar,isActive,isLocked,
        twoFactorEnabled,lastLoginAt,sessionTimeout,
        employeeCode,designation,dateOfBirth,dateOfJoining,dateOfLeaving,gender,maritalStatus,bloodGroup,
        personalEmail,currentAddress,emergencyContactName,emergencyContactPhone,panNumber,aadharNumber,
        bankAccountName,bankAccountNumber,bankIFSC,bankName,uanNumber,pfNumber,esiNumber,employmentType,
        fatherName,
        permanentAddress,permanentCity,permanentDistrict,permanentState,permanentPincode,
        presentAddress,presentCity,presentDistrict,presentState,presentPincode,presentAddressSameAsPermanent,
        bankBranchName,upiId,
        createdAt,updatedAt';

    /** HR-profile fields accepted by create()/update() — all live directly on the User table. */
    private const HR_FIELDS = [
        'employeeCode','designation','gender','maritalStatus','bloodGroup','personalEmail','currentAddress',
        'emergencyContactName','emergencyContactPhone','panNumber','aadharNumber',
        'bankAccountName','bankAccountNumber','bankIFSC','bankName','uanNumber','pfNumber','esiNumber','employmentType',
        'fatherName',
        'permanentAddress','permanentCity','permanentDistrict','permanentState','permanentPincode',
        'presentAddress','presentCity','presentDistrict','presentState','presentPincode',
        'bankBranchName','upiId',
    ];
    private const HR_DATE_FIELDS = ['dateOfBirth', 'dateOfJoining', 'dateOfLeaving'];
    /** Boolean HR fields — handled separately from HR_FIELDS since they need bool_val(), not trim-to-null. */
    private const HR_BOOL_FIELDS = ['presentAddressSameAsPermanent'];
    private const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'];

    private function fetchSafe(string $id): ?array
    {
        $stmt = db()->prepare(
            'SELECT id,name,email,role,phone,department,avatar,isActive,isLocked,
                    twoFactorEnabled,lastLoginAt,sessionTimeout,
                    employeeCode,designation,dateOfBirth,dateOfJoining,dateOfLeaving,gender,maritalStatus,bloodGroup,
                    personalEmail,currentAddress,emergencyContactName,emergencyContactPhone,panNumber,aadharNumber,
                    bankAccountName,bankAccountNumber,bankIFSC,bankName,uanNumber,pfNumber,esiNumber,employmentType,
                    fatherName,
                    permanentAddress,permanentCity,permanentDistrict,permanentState,permanentPincode,
                    presentAddress,presentCity,presentDistrict,presentState,presentPincode,presentAddressSameAsPermanent,
                    bankBranchName,upiId,
                    createdAt,updatedAt
             FROM `User` WHERE id=? LIMIT 1'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if ($row) {
            $row['isActive'] = (bool)$row['isActive'];
            $row['isLocked'] = (bool)$row['isLocked'];
            $row['twoFactorEnabled'] = (bool)$row['twoFactorEnabled'];
            $row['presentAddressSameAsPermanent'] = (bool)$row['presentAddressSameAsPermanent'];
        }
        return $row ?: null;
    }

    // GET /api/users
    public function index(): void
    {
        $auth = authenticate(); require_admin($auth);
        [$page, $limit, $offset] = paginate(50);
        $search   = qp('search', '');
        $role     = qp('role', '');
        $isActive = qp('isActive', null);

        $where = []; $params = [];
        if ($search) {
            $like = "%$search%";
            $where[] = '(name LIKE ? OR email LIKE ? OR department LIKE ?)';
            $params = array_merge($params, [$like, $like, $like]);
        }
        if ($role) { $where[] = 'role=?'; $params[] = $role; }
        if ($isActive !== null) { $where[] = 'isActive=?'; $params[] = ($isActive === 'true' ? 1 : 0); }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $total = (int)db()->prepare("SELECT COUNT(*) FROM `User` $w")->execute($params) ? 0 : 0;
        $s = db()->prepare("SELECT COUNT(*) FROM `User` $w"); $s->execute($params);
        $total = (int)$s->fetchColumn();

        $s2 = db()->prepare(
            "SELECT id,name,email,role,phone,department,avatar,isActive,isLocked,
                    twoFactorEnabled,lastLoginAt,sessionTimeout,
                    employeeCode,designation,dateOfJoining,employmentType,createdAt,updatedAt
             FROM `User` $w ORDER BY name ASC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $users = array_map([$this, 'castBools'], $s2->fetchAll());
        sendPaginated($users, $total, $page, $limit, 'Users fetched');
    }

    // GET /api/users/:id
    public function show(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $user = $this->fetchSafe($id);
        if (!$user) sendError('User not found.', 404);
        sendSuccess(['user' => $user]);
    }

    // POST /api/users
    public function create(): void
    {
        $auth = authenticate(); require_admin($auth);
        $body = request_body();
        $name    = trim($body['name'] ?? '');
        $email   = strtolower(trim($body['email'] ?? ''));
        $pass    = $body['password'] ?? '';
        $role    = $body['role'] ?? 'SALES';
        $phone   = trim($body['phone'] ?? '');
        $dept    = trim($body['department'] ?? '');
        $timeout = isset($body['sessionTimeout']) ? (int)$body['sessionTimeout'] : 480;

        if (!$name || !$email || !$pass) sendError('Name, email, and password are required.', 400);
        if (!in_array($role, self::ROLES)) sendError('Role must be one of: ' . implode(', ', self::ROLES), 400);
        if (strlen($pass) < 6) sendError('Password must be at least 6 characters.', 400);

        $s = db()->prepare('SELECT id FROM `User` WHERE email=? LIMIT 1');
        $s->execute([$email]);
        if ($s->fetch()) sendError('An account with this email already exists.', 409);

        $hr = $this->hrFieldsFromBody($body);
        if ($hr['employeeCode']) {
            $ec = db()->prepare('SELECT id FROM `User` WHERE employeeCode=? LIMIT 1');
            $ec->execute([$hr['employeeCode']]);
            if ($ec->fetch()) sendError("Employee code \"{$hr['employeeCode']}\" is already in use.", 409);
        }

        $hash = password_hash($pass, PASSWORD_BCRYPT, ['cost' => 12]);
        $id   = gen_id();
        db()->prepare(
            'INSERT INTO `User`
             (id,name,email,password,role,phone,department,sessionTimeout,
              employeeCode,designation,dateOfBirth,dateOfJoining,dateOfLeaving,gender,maritalStatus,bloodGroup,
              personalEmail,currentAddress,emergencyContactName,emergencyContactPhone,panNumber,aadharNumber,
              bankAccountName,bankAccountNumber,bankIFSC,bankName,uanNumber,pfNumber,esiNumber,employmentType,
              fatherName,
              permanentAddress,permanentCity,permanentDistrict,permanentState,permanentPincode,
              presentAddress,presentCity,presentDistrict,presentState,presentPincode,presentAddressSameAsPermanent,
              bankBranchName,upiId,
              createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?,?,
                     ?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?, ?,?)'
        )->execute([
            $id, $name, $email, $hash, $role, $phone ?: null, $dept ?: null, $timeout,
            $hr['employeeCode'], $hr['designation'], $hr['dateOfBirth'], $hr['dateOfJoining'], $hr['dateOfLeaving'],
            $hr['gender'], $hr['maritalStatus'], $hr['bloodGroup'],
            $hr['personalEmail'], $hr['currentAddress'], $hr['emergencyContactName'], $hr['emergencyContactPhone'],
            $hr['panNumber'], $hr['aadharNumber'],
            $hr['bankAccountName'], $hr['bankAccountNumber'], $hr['bankIFSC'], $hr['bankName'],
            $hr['uanNumber'], $hr['pfNumber'], $hr['esiNumber'], $hr['employmentType'],
            $hr['fatherName'],
            $hr['permanentAddress'], $hr['permanentCity'], $hr['permanentDistrict'], $hr['permanentState'], $hr['permanentPincode'],
            $hr['presentAddress'], $hr['presentCity'], $hr['presentDistrict'], $hr['presentState'], $hr['presentPincode'],
            $hr['presentAddressSameAsPermanent'] ? 1 : 0,
            $hr['bankBranchName'], $hr['upiId'],
            now_sql(), now_sql(),
        ]);

        log_activity($auth['id'], 'USER_CREATED', 'User', $id, ['name'=>$name,'email'=>$email,'role'=>$role]);
        sendSuccess(['user' => $this->fetchSafe($id)], 'User created successfully', 201);
    }

    /** Normalizes HR-profile fields from a request body. Every key is always present (null when absent/blank) so create() can bind positionally. */
    private function hrFieldsFromBody(array $body): array
    {
        $out = [];
        foreach (self::HR_FIELDS as $f) {
            $val = array_key_exists($f, $body) ? trim((string)($body[$f] ?? '')) : '';
            $out[$f] = $val !== '' ? $val : null;
        }
        foreach (self::HR_DATE_FIELDS as $f) {
            $out[$f] = array_key_exists($f, $body) ? to_date_only($body[$f]) : null;
        }
        foreach (self::HR_BOOL_FIELDS as $f) {
            $out[$f] = array_key_exists($f, $body) ? bool_val($body[$f]) : false;
        }
        $out['employmentType'] = $out['employmentType'] ?: 'FULL_TIME';
        if (!in_array($out['employmentType'], self::EMPLOYMENT_TYPES)) {
            sendError('Employment type must be one of: ' . implode(', ', self::EMPLOYMENT_TYPES), 400);
        }
        return $out;
    }

    // PUT /api/users/:id
    public function update(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $body = request_body();

        $existing = $this->fetchSafe($id);
        if (!$existing) sendError('User not found.', 404);

        $role = $body['role'] ?? null;
        if ($role && !in_array($role, self::ROLES)) sendError('Invalid role.', 400);

        $sets = []; $params = [];
        if (!empty($body['name']))                    { $sets[]='name=?';           $params[]=trim($body['name']); }
        if (array_key_exists('phone',$body))          { $sets[]='phone=?';          $params[]=trim($body['phone'])?: null; }
        if (array_key_exists('department',$body))     { $sets[]='department=?';     $params[]=trim($body['department'])?: null; }
        if ($role)                                    { $sets[]='role=?';           $params[]=$role; }
        if (!empty($body['sessionTimeout']))          { $sets[]='sessionTimeout=?'; $params[]=(int)$body['sessionTimeout']; }

        // ── HR profile fields (Payroll & HR module) — partial update, admin-only ──
        if (array_key_exists('employeeCode', $body)) {
            $ec = trim((string)($body['employeeCode'] ?? ''));
            if ($ec !== '') {
                $es = db()->prepare('SELECT id FROM `User` WHERE employeeCode=? AND id<>? LIMIT 1');
                $es->execute([$ec, $id]);
                if ($es->fetch()) sendError("Employee code \"$ec\" is already in use.", 409);
            }
        }
        foreach (self::HR_FIELDS as $f) {
            if (!array_key_exists($f, $body)) continue;
            if ($f === 'employmentType') {
                $val = trim((string)($body[$f] ?? '')) ?: 'FULL_TIME';
                if (!in_array($val, self::EMPLOYMENT_TYPES)) {
                    sendError('Employment type must be one of: ' . implode(', ', self::EMPLOYMENT_TYPES), 400);
                }
                $sets[] = "$f=?"; $params[] = $val;
            } else {
                $val = trim((string)($body[$f] ?? ''));
                $sets[] = "$f=?"; $params[] = $val !== '' ? $val : null;
            }
        }
        foreach (self::HR_DATE_FIELDS as $f) {
            if (array_key_exists($f, $body)) { $sets[] = "$f=?"; $params[] = to_date_only($body[$f]); }
        }
        foreach (self::HR_BOOL_FIELDS as $f) {
            if (array_key_exists($f, $body)) { $sets[] = "$f=?"; $params[] = bool_val($body[$f]) ? 1 : 0; }
        }

        if (!empty($sets)) {
            $params[] = $id;
            db()->prepare('UPDATE `User` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        }
        log_activity($auth['id'], 'USER_UPDATED', 'User', $id);
        sendSuccess(['user' => $this->fetchSafe($id)], 'User updated');
    }

    // DELETE /api/users/:id  (soft-deactivate)
    public function delete(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        if ($id === $auth['id']) sendError('You cannot deactivate your own account.', 400);
        $s = db()->prepare('UPDATE `User` SET isActive=0 WHERE id=?');
        if (!$s->execute([$id]) || $s->rowCount() === 0) sendError('User not found.', 404);
        sendSuccess(['user' => $this->fetchSafe($id)], 'User deactivated');
    }

    // PATCH /api/users/:id/reset-password
    public function resetPassword(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $body = request_body();
        $new_pw = $body['newPassword'] ?? '';
        if (!$new_pw || strlen($new_pw) < 6) sendError('New password must be at least 6 characters.', 400);
        $hash = password_hash($new_pw, PASSWORD_BCRYPT, ['cost' => 12]);
        $s = db()->prepare('UPDATE `User` SET password=?,failedLoginCount=0,isLocked=0 WHERE id=?');
        if (!$s->execute([$hash, $id]) || $s->rowCount() === 0) sendError('User not found.', 404);
        log_activity($auth['id'], 'PASSWORD_RESET', 'User', $id);
        sendSuccess([], 'Password reset successfully');
    }

    // PATCH /api/users/:id/toggle-lock
    public function toggleLock(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->prepare('SELECT id,isLocked FROM `User` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        $user = $s->fetch();
        if (!$user) sendError('User not found.', 404);
        $newLocked = (bool)$user['isLocked'] ? 0 : 1;
        db()->prepare('UPDATE `User` SET isLocked=? WHERE id=?')->execute([$newLocked, $id]);
        $action = $newLocked ? 'USER_LOCKED' : 'USER_UNLOCKED';
        log_activity($auth['id'], $action, 'User', $id);
        sendSuccess(['isLocked' => (bool)$newLocked], $newLocked ? 'Account locked' : 'Account unlocked');
    }

    // PATCH /api/users/:id/reactivate
    public function reactivate(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->prepare('UPDATE `User` SET isActive=1,isLocked=0,failedLoginCount=0 WHERE id=?');
        if (!$s->execute([$id]) || $s->rowCount() === 0) sendError('User not found.', 404);
        sendSuccess(['user' => $this->fetchSafe($id)], 'User reactivated');
    }

    // GET /api/users/export
    public function export(): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->query('SELECT name,email,role,department,phone,isActive,createdAt FROM `User` ORDER BY name');
        $rows = $s->fetchAll();
        $w = new XlsxWriter('Users');
        $w->addRow(['Name','Email','Role','Department','Phone','Active','Created At']);
        foreach ($rows as $r) {
            $w->addRow([$r['name'],$r['email'],$r['role'],$r['department']??'',$r['phone']??'',$r['isActive']?'Yes':'No',$r['createdAt']]);
        }
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="users-export.xlsx"');
        echo $w->output(); exit;
    }

    private function castBools(array $row): array
    {
        foreach (['isActive','isLocked','twoFactorEnabled'] as $k) {
            if (array_key_exists($k,$row)) $row[$k] = (bool)$row[$k];
        }
        return $row;
    }
}
