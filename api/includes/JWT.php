<?php
/**
 * Minimal, dependency-free HS256 JWT implementation — a drop-in
 * replacement for the `jsonwebtoken` npm package used by the Node
 * backend (jwt.sign / jwt.verify). No Composer packages required.
 */

class JWTException extends \Exception {}
class TokenExpiredException extends JWTException {}
class TokenInvalidException extends JWTException {}

class JWT
{
    /** Sign a payload. $expiresIn accepts "7d", "12h", "30m", "45s" or a plain number of seconds. */
    public static function sign(array $payload, string $secret, string $expiresIn = '7d'): string
    {
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $now = time();
        $payload['iat'] = $now;
        $payload['exp'] = $now + self::parseDuration($expiresIn);

        $segments = [
            self::base64UrlEncode(json_encode($header)),
            self::base64UrlEncode(json_encode($payload)),
        ];
        $signingInput = implode('.', $segments);
        $signature = hash_hmac('sha256', $signingInput, $secret, true);
        $segments[] = self::base64UrlEncode($signature);

        return implode('.', $segments);
    }

    /** Verify and decode. Throws TokenExpiredException / TokenInvalidException on failure. */
    public static function verify(string $jwt, string $secret): array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            throw new TokenInvalidException('Invalid token.');
        }
        [$head64, $payload64, $sig64] = $parts;

        $expectedSig = hash_hmac('sha256', "$head64.$payload64", $secret, true);
        $actualSig = self::base64UrlDecode($sig64);
        if (!hash_equals($expectedSig, $actualSig)) {
            throw new TokenInvalidException('Invalid token.');
        }

        $payload = json_decode(self::base64UrlDecode($payload64), true);
        if (!is_array($payload)) {
            throw new TokenInvalidException('Invalid token.');
        }
        if (isset($payload['exp']) && time() > $payload['exp']) {
            throw new TokenExpiredException('Token expired.');
        }

        return $payload;
    }

    private static function parseDuration(string|int $expr): int
    {
        if (is_int($expr) || ctype_digit((string) $expr)) {
            return (int) $expr;
        }
        if (preg_match('/^(\d+)\s*([smhd])$/i', trim((string) $expr), $m)) {
            $n = (int) $m[1];
            return match (strtolower($m[2])) {
                's' => $n,
                'm' => $n * 60,
                'h' => $n * 3600,
                'd' => $n * 86400,
                default => $n,
            };
        }
        return 7 * 86400; // fallback: 7 days
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $data): string
    {
        $remainder = strlen($data) % 4;
        if ($remainder) {
            $data .= str_repeat('=', 4 - $remainder);
        }
        return base64_decode(strtr($data, '-_', '+/'));
    }
}
