import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    checkEndpointHealth,
    validateEndpointInput,
} from '../src/core/endpointMonitor';

describe('validateEndpointInput', () => {
    it('trims values and normalizes valid HTTP URLs', () => {
        expect(validateEndpointInput(' Public API ', ' https://example.com/health '))
            .toEqual({ valid: true, name: 'Public API', url: 'https://example.com/health' });
    });

    it.each([
        ['', 'https://example.com', 'name-required'],
        ['x'.repeat(51), 'https://example.com', 'name-too-long'],
        ['API', '', 'url-required'],
        ['API', 'not a URL', 'url-invalid'],
        ['API', 'ftp://example.com', 'url-protocol'],
        ['API', 'https://user:pass@example.com', 'url-credentials'],
    ] as const)('rejects invalid input (%s, %s)', (name, url, error) => {
        expect(validateEndpointInput(name, url)).toMatchObject({ valid: false, error });
    });
});

describe('checkEndpointHealth', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('marks successful HTTP responses healthy and records status and latency', async () => {
        const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 });
        const times = [100, 137];

        const result = await checkEndpointHealth('https://example.com/health', {
            fetchImpl,
            now: () => times.shift() ?? 137,
        });

        expect(result).toMatchObject({ status: 'up', httpStatus: 204, latencyMs: 37 });
        expect(result.checkedAt).toEqual(expect.any(Number));
    });

    it('uses credential-free GET requests suitable for browser health checks', async () => {
        let requestInit: RequestInit | undefined;
        const fetchImpl: typeof fetch = async (_input, init) => {
            requestInit = init;
            return new Response(null, { status: 200 });
        };

        await checkEndpointHealth('https://example.com/health', { fetchImpl });

        expect(requestInit).toMatchObject({
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
        });
    });

    it('treats non-2xx responses as unhealthy', async () => {
        const fetchImpl: typeof fetch = async () => new Response(null, { status: 503 });

        await expect(checkEndpointHealth('https://example.com/health', { fetchImpl }))
            .resolves.toMatchObject({ status: 'down', httpStatus: 503, error: 'HTTP 503' });
    });

    it('uses a bounded request timeout', async () => {
        vi.useFakeTimers();
        const fetchImpl: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });

        const check = checkEndpointHealth('https://example.com/health', {
            fetchImpl,
            timeoutMs: 25,
        });
        await vi.advanceTimersByTimeAsync(25);

        await expect(check).resolves.toMatchObject({ status: 'down', error: 'Request timed out' });
    });

    it('reports CORS, TLS, and network failures without leaking exception details', async () => {
        const fetchImpl: typeof fetch = async () => {
            throw new Error('sensitive internal detail');
        };

        await expect(checkEndpointHealth('https://example.com/health', { fetchImpl }))
            .resolves.toMatchObject({ status: 'down', error: 'Network, CORS, or TLS error' });
    });

    it('reports a caller-canceled check', async () => {
        const controller = new AbortController();
        const fetchImpl: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
        const check = checkEndpointHealth('https://example.com/health', {
            fetchImpl,
            signal: controller.signal,
        });
        controller.abort();

        await expect(check).resolves.toMatchObject({ status: 'down', error: 'Check canceled' });
    });

    it('rejects invalid timeouts before starting a request', async () => {
        const fetchImpl = vi.fn<typeof fetch>();

        await expect(checkEndpointHealth('https://example.com/health', {
            fetchImpl,
            timeoutMs: 0,
        })).rejects.toThrow('timeoutMs must be a positive finite number');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
