<?php
/**
 * Mailer (v11.52) — sends one e-mail with attachments. No Composer needed.
 *
 * How it sends (api/.env):
 *   SMTP_HOST=smtp.hostinger.com   SMTP_PORT=465 (SSL) or 587 (STARTTLS)
 *   SMTP_USER=sales@apjtech.in     SMTP_PASS=…           → sends through that mailbox (recommended)
 *   no SMTP_HOST                                          → PHP mail() of the hosting (works on most cPanel / Hostinger plans)
 *   MAIL_DRIVER=log                                       → writes the message to api/storage/mail-outbox/ instead (testing)
 * Optional: MAIL_FROM_TMS / MAIL_FROM_APJ — the "From" address per company (else SMTP_USER, else the company e-mail on the letterhead).
 */
class Mailer
{
    public static function driver(): string
    {
        $d = strtolower((string) env('MAIL_DRIVER', ''));
        if ($d === 'log') return 'log';
        if (env('SMTP_HOST')) return 'smtp';
        return 'mail';
    }

    private static function hdr(string $s): string
    {
        $s = str_replace(["\r", "\n"], ' ', $s);
        return preg_match('/[^\x20-\x7e]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
    }

    private static function addr(string $email, string $name = ''): string
    {
        $email = trim(str_replace(["\r", "\n", '<', '>'], '', $email));
        return $name !== '' ? self::hdr($name) . " <$email>" : $email;
    }

    /** Valid, de-duplicated addresses from "a@x.com, b@y.com; c@z.com". */
    public static function list($v): array
    {
        $out = [];
        foreach (preg_split('/[,;\s]+/', is_array($v) ? implode(',', $v) : (string) $v) as $e) {
            $e = strtolower(trim($e));
            if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) $out[$e] = $e;
        }
        return array_values($out);
    }

    /**
     * $m: from, fromName, replyTo, to[], cc[], subject, text, html?, attachments[[name, mime, bytes]]
     * → ['ok' => bool, 'error' => ?string, 'driver' => string, 'messageId' => string]
     */
    public static function send(array $m): array
    {
        $driver = self::driver();
        $host = preg_replace('/[^a-z0-9.\-]/i', '', (string) (parse_url((string) env('APP_URL', 'https://apjtech.in'), PHP_URL_HOST) ?: 'apjtech.in'));
        $mid = '<' . bin2hex(random_bytes(10)) . '@' . $host . '>';
        $mixed = 'mx_' . bin2hex(random_bytes(8)); $alt = 'al_' . bin2hex(random_bytes(8));
        $text = str_replace(["\r\n", "\r"], "\n", (string) ($m['text'] ?? ''));
        $html = $m['html'] ?? ('<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">' . nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8')) . '</div>');
        $h = [
            'From: ' . self::addr($m['from'], (string) ($m['fromName'] ?? '')),
            'Date: ' . date('r'),
            'Message-ID: ' . $mid,
            'MIME-Version: 1.0',
            'X-Mailer: CRM',
        ];
        if (!empty($m['replyTo'])) $h[] = 'Reply-To: ' . self::addr($m['replyTo']);
        if (!empty($m['cc'])) $h[] = 'Cc: ' . implode(', ', array_map([self::class, 'addr'], $m['cc']));
        $h[] = "Content-Type: multipart/mixed; boundary=\"$mixed\"";
        $b = "--$mixed\r\nContent-Type: multipart/alternative; boundary=\"$alt\"\r\n\r\n"
           . "--$alt\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text)) . "\r\n"
           . "--$alt\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "\r\n"
           . "--$alt--\r\n";
        foreach (($m['attachments'] ?? []) as $a) {
            $n = self::hdr(str_replace('"', '', $a[0]));
            $b .= "--$mixed\r\nContent-Type: {$a[1]}; name=\"$n\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"$n\"\r\n\r\n" . chunk_split(base64_encode($a[2])) . "\r\n";
        }
        $b .= "--$mixed--\r\n";
        $subject = self::hdr((string) $m['subject']);
        $to = $m['to'];
        try {
            if ($driver === 'log') {
                $dir = BASE_PATH . '/storage/mail-outbox';
                if (!is_dir($dir)) @mkdir($dir, 0755, true);
                $raw = 'To: ' . implode(', ', $to) . "\r\nSubject: $subject\r\n" . implode("\r\n", $h) . "\r\n\r\n" . $b;
                if (@file_put_contents($dir . '/' . date('Ymd-His') . '-' . substr(md5($mid), 0, 8) . '.eml', $raw) === false) throw new RuntimeException('Could not write the test outbox.');
            } elseif ($driver === 'smtp') {
                self::smtp(array_merge($to, $m['cc'] ?? []), $m['from'], 'To: ' . implode(', ', $to) . "\r\nSubject: $subject\r\n" . implode("\r\n", $h) . "\r\n\r\n" . $b);
            } else {
                if (!function_exists('mail')) throw new RuntimeException('This server cannot send e-mail (PHP mail() is switched off). Add SMTP_HOST / SMTP_USER / SMTP_PASS to api/.env.');
                $ok = @mail(implode(', ', $to), $subject, $b, implode("\r\n", $h), filter_var($m['from'], FILTER_VALIDATE_EMAIL) ? '-f' . $m['from'] : '');
                if (!$ok) throw new RuntimeException('The server refused to send the e-mail (PHP mail()). Ask the hosting to enable mail, or add SMTP settings to api/.env.');
            }
            return ['ok' => true, 'error' => null, 'driver' => $driver, 'messageId' => $mid];
        } catch (Throwable $e) {
            return ['ok' => false, 'error' => $e->getMessage(), 'driver' => $driver, 'messageId' => $mid];
        }
    }

    private static function smtp(array $rcpt, string $from, string $data): void
    {
        $host = (string) env('SMTP_HOST'); $port = (int) env('SMTP_PORT', 465);
        $ssl = $port === 465 || strtolower((string) env('SMTP_SECURE', '')) === 'ssl';
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
        $fp = @stream_socket_client(($ssl ? 'ssl://' : 'tcp://') . $host . ':' . $port, $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) throw new RuntimeException("Could not connect to the mail server $host:$port ($errstr).");
        stream_set_timeout($fp, 30);
        $read = function () use ($fp): string { $r = ''; while (($l = fgets($fp, 1024)) !== false) { $r .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; } return $r; };
        $cmd = function (?string $c, array $ok) use ($fp, $read): string {
            if ($c !== null) fwrite($fp, $c . "\r\n");
            $r = $read();
            if (!in_array((int) substr($r, 0, 3), $ok, true)) throw new RuntimeException('Mail server said: ' . trim($r ?: 'no answer') . ($c !== null && stripos($c, 'AUTH') === false ? '' : ' (check SMTP_USER / SMTP_PASS)'));
            return $r;
        };
        $me = gethostname() ?: 'localhost';
        $cmd(null, [220]);
        $cmd("EHLO $me", [250]);
        if (!$ssl) {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('Could not start TLS with the mail server.');
            $cmd("EHLO $me", [250]);
        }
        if (env('SMTP_USER')) {
            $cmd('AUTH LOGIN', [334]);
            $cmd(base64_encode((string) env('SMTP_USER')), [334]);
            $cmd(base64_encode((string) env('SMTP_PASS')), [235]);
        }
        $cmd('MAIL FROM:<' . $from . '>', [250]);
        foreach ($rcpt as $r) $cmd('RCPT TO:<' . $r . '>', [250, 251]);
        $cmd('DATA', [354]);
        $data = preg_replace('/^\./m', '..', str_replace(["\r\n", "\r", "\n"], ["\n", "\n", "\r\n"], $data));
        $cmd($data . "\r\n.", [250]);
        @fwrite($fp, "QUIT\r\n");
        fclose($fp);
    }
}
