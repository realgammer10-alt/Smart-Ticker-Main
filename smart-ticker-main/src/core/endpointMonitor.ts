export type EndpointInputError =
    | 'name-required'
    | 'name-too-long'
    | 'url-required'
    | 'url-too-long'
    | 'url-invalid'
    | 'url-protocol'
    | 'url-credentials';

export type ValidatedEndpointInput =
    | { valid: true; name: string; url: string }
    | { valid: false; field: 'name' | 'url'; error: EndpointInputError };

export interface EndpointCheckResult {
    status: 'up' | 'down';
    checkedAt: number;
    latencyMs: number;
    httpStatus?: number;
    error?: string;
}

export interface EndpointCheckOptions {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
    signal?: AbortSignal;
}

export const DEFAULT_CHECK_TIMEOUT_MS = 8_000;
export const MAX_ENDPOINT_NAME_LENGTH = 50;
export const MAX_ENDPOINT_URL_LENGTH = 2_048;

export function validateEndpointInput(nameInput: string, urlInput: string): ValidatedEndpointInput {
    const name = nameInput.trim();
    const rawUrl = urlInput.trim();

    if (!name) return { valid: false, field: 'name', error: 'name-required' };
    if (name.length > MAX_ENDPOINT_NAME_LENGTH) {
        return { valid: false, field: 'name', error: 'name-too-long' };
    }
    if (!rawUrl) return { valid: false, field: 'url', error: 'url-required' };
    if (rawUrl.length > MAX_ENDPOINT_URL_LENGTH) {
        return { valid: false, field: 'url', error: 'url-too-long' };
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        return { valid: false, field: 'url', error: 'url-invalid' };
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return { valid: false, field: 'url', error: 'url-protocol' };
    }
    if (parsedUrl.username || parsedUrl.password) {
        return { valid: false, field: 'url', error: 'url-credentials' };
    }

    return { valid: true, name, url: parsedUrl.toString() };
}

export async function checkEndpointHealth(
    url: string,
    options: EndpointCheckOptions = {},
): Promise<EndpointCheckResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError('timeoutMs must be a positive finite number');
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const now = options.now ?? (() => performance.now());
    const startedAt = now();
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();

    if (options.signal?.aborted) {
        controller.abort();
    } else {
        options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }

    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetchImpl(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'follow',
            signal: controller.signal,
        });
        if (timedOut || options.signal?.aborted) {
            throw new DOMException('Request canceled', 'AbortError');
        }
        controller.abort();
        const latencyMs = Math.max(0, Math.round(now() - startedAt));

        return {
            status: response.ok ? 'up' : 'down',
            checkedAt: Date.now(),
            latencyMs,
            httpStatus: response.status,
            ...(response.ok ? {} : { error: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}` }),
        };
    } catch {
        return {
            status: 'down',
            checkedAt: Date.now(),
            latencyMs: Math.max(0, Math.round(now() - startedAt)),
            error: timedOut
                ? 'Request timed out'
                : options.signal?.aborted
                    ? 'Check canceled'
                    : 'Network, CORS, or TLS error',
        };
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abortFromCaller);
    }
}
