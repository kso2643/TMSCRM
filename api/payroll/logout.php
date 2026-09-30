<?php
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
}
payroll_logout();
redirect('login.php');
