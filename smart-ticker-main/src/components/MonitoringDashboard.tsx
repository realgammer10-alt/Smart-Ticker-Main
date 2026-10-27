import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Ticker, { Presets } from './Ticker';
import {
    checkEndpointHealth,
    MAX_ENDPOINT_NAME_LENGTH,
    MAX_ENDPOINT_URL_LENGTH,
    validateEndpointInput,
    type EndpointCheckResult,
} from '../core/endpointMonitor';
import './MonitoringDashboard.css';

type Language = 'en' | 'zh';
type EndpointStatus = 'unknown' | 'up' | 'down';
type PollInterval = 10 | 30 | 60;

interface MonitoredEndpoint {
    id: string;
    name: string;
    url: string;
    status: EndpointStatus;
    isChecking: boolean;
    lastCheck: EndpointCheckResult | null;
}

interface SavedMonitorConfig {
    version: 1;
    pollInterval: PollInterval;
    endpoints: Array<{ id: string; name: string; url: string }>;
}

interface MonitorCopy {
    title: string;
    subtitle: string;
    addEndpoint: string;
    name: string;
    namePlaceholder: string;
    url: string;
    urlPlaceholder: string;
    add: string;
    refreshAll: string;
    checking: string;
    up: string;
    down: string;
    waiting: string;
    remove: string;
    checkNow: string;
    pollEvery: string;
    seconds: string;
    total: string;
    healthy: string;
    failing: string;
    noEndpoints: string;
    noEndpointsHint: string;
    checked: string;
    neverChecked: string;
    timeout: string;
    networkError: string;
    canceled: string;
    corsNote: string;
    storageError: string;
    duplicateName: string;
    tooManyEndpoints: string;
    inputErrors: Record<string, string>;
}

const STORAGE_KEY = 'smart-ticker.monitor.v1';
const MAX_ENDPOINTS = 12;
const POLL_INTERVALS: PollInterval[] = [10, 30, 60];

const copyByLanguage: Record<Language, MonitorCopy> = {
    en: {
        title: 'API health monitor',
        subtitle: 'Track endpoint availability and response time in real time.',
        addEndpoint: 'Add an endpoint',
        name: 'Service name',
        namePlaceholder: 'e.g. Public API',
        url: 'Health-check URL',
        urlPlaceholder: 'https://api.example.com/health',
        add: 'Add endpoint',
        refreshAll: 'Check all now',
        checking: 'Checking',
        up: 'Operational',
        down: 'Unhealthy',
        waiting: 'Waiting for first check',
        remove: 'Remove',
        checkNow: 'Check now',
        pollEvery: 'Check every',
        seconds: 'seconds',
        total: 'Monitored',
        healthy: 'Operational',
        failing: 'Unhealthy',
        noEndpoints: 'No endpoints yet',
        noEndpointsHint: 'Add an HTTP or HTTPS URL to start monitoring.',
        checked: 'Last checked',
        neverChecked: 'Not checked yet',
        timeout: 'Request timed out',
        networkError: 'Network, CORS, or TLS error',
        canceled: 'Check canceled',
        corsNote: 'Checks run in your browser. Cross-origin endpoints must allow CORS; use a lightweight, unauthenticated health URL.',
        storageError: 'Monitor settings could not be saved in this browser.',
        duplicateName: 'An endpoint with this name already exists.',
        tooManyEndpoints: `You can monitor up to ${MAX_ENDPOINTS} endpoints.`,
        inputErrors: {
            'name-required': 'Enter a service name.',
            'name-too-long': 'Service names must be 50 characters or fewer.',
            'url-required': 'Enter a health-check URL.',
            'url-too-long': 'URLs must be 2,048 characters or fewer.',
            'url-invalid': 'Enter a valid absolute URL.',
            'url-protocol': 'Only HTTP and HTTPS URLs are supported.',
            'url-credentials': 'URLs with embedded usernames or passwords are not allowed.',
        },
    },
    zh: {
        title: 'API 健康监控',
        subtitle: '实时查看端点可用性和响应时间。',
        addEndpoint: '添加监控端点',
        name: '服务名称',
        namePlaceholder: '例如：公共 API',
        url: '健康检查 URL',
        urlPlaceholder: 'https://api.example.com/health',
        add: '添加端点',
        refreshAll: '立即检查全部',
        checking: '检查中',
        up: '运行正常',
        down: '异常',
        waiting: '等待首次检查',
        remove: '移除',
        checkNow: '立即检查',
        pollEvery: '检查间隔',
        seconds: '秒',
        total: '监控中',
        healthy: '运行正常',
        failing: '异常',
        noEndpoints: '尚无监控端点',
        noEndpointsHint: '添加 HTTP 或 HTTPS 地址以开始监控。',
        checked: '上次检查',
        neverChecked: '尚未检查',
        timeout: '请求超时',
        networkError: '网络、CORS 或 TLS 错误',
        canceled: '检查已取消',
        corsNote: '检查在浏览器中运行。跨域端点必须允许 CORS；建议使用轻量、无需身份验证的健康检查地址。',
        storageError: '无法在此浏览器中保存监控设置。',
        duplicateName: '已存在同名端点。',
        tooManyEndpoints: `最多可监控 ${MAX_ENDPOINTS} 个端点。`,
        inputErrors: {
            'name-required': '请输入服务名称。',
            'name-too-long': '服务名称不能超过 50 个字符。',
            'url-required': '请输入健康检查 URL。',
            'url-too-long': 'URL 不能超过 2,048 个字符。',
            'url-invalid': '请输入有效的绝对 URL。',
            'url-protocol': '仅支持 HTTP 和 HTTPS URL。',
            'url-credentials': 'URL 中不能包含用户名或密码。',
        },
    },
};

function createEndpointId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeEndpoint(id: string, name: string, url: string): MonitoredEndpoint {
    return { id, name, url, status: 'unknown', isChecking: false, lastCheck: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSavedEndpoint(value: unknown): value is { id: string; name: string; url: string } {
    return isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        typeof value.url === 'string';
}

function loadSavedConfig(): {
    endpoints: MonitoredEndpoint[];
    pollInterval: PollInterval;
    error: string;
} {
    if (typeof window === 'undefined') {
        return { endpoints: [], pollInterval: 30, error: '' };
    }

    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) return { endpoints: [], pollInterval: 30, error: '' };

        const parsed: unknown = JSON.parse(stored);
        if (!isRecord(parsed) || parsed.version !== 1) {
            return { endpoints: [], pollInterval: 30, error: 'invalid' };
        }

        const pollInterval = POLL_INTERVALS.find((seconds) => seconds === parsed.pollInterval) ?? 30;
        const endpoints = Array.isArray(parsed.endpoints)
            ? parsed.endpoints.slice(0, MAX_ENDPOINTS).flatMap((endpoint: unknown) => {
                if (!isSavedEndpoint(endpoint)) return [];
                const validated = validateEndpointInput(endpoint.name, endpoint.url);
                return validated.valid
                    ? [makeEndpoint(endpoint.id.slice(0, 100), validated.name, validated.url)]
                    : [];
            })
            : [];

        return { endpoints, pollInterval, error: '' };
    } catch {
        return { endpoints: [], pollInterval: 30, error: 'unavailable' };
    }
}

function statusLabel(status: EndpointStatus, isChecking: boolean, labels: MonitorCopy): string {
    if (isChecking) return labels.checking;
    if (status === 'up') return labels.up;
    if (status === 'down') return labels.down;
    return labels.waiting;
}

function errorLabel(error: string | undefined, labels: MonitorCopy): string {
    if (error === 'Request timed out') return labels.timeout;
    if (error === 'Check canceled') return labels.canceled;
    if (error === 'Network, CORS, or TLS error') return labels.networkError;
    return error ?? '';
}

interface MonitoringDashboardProps {
    lang: Language;
}

export default function MonitoringDashboard({ lang }: MonitoringDashboardProps) {
    const labels = copyByLanguage[lang];
    const [initialConfig] = useState(loadSavedConfig);
    const [endpoints, setEndpoints] = useState(initialConfig.endpoints);
    const [pollInterval, setPollInterval] = useState<PollInterval>(initialConfig.pollInterval);
    const [storageError, setStorageError] = useState(initialConfig.error);
    const [nameInput, setNameInput] = useState('');
    const [urlInput, setUrlInput] = useState('');
    const [formError, setFormError] = useState('');
    const checksInProgress = useRef(new Map<string, AbortController>());
    const endpointsRef = useRef(endpoints);
    endpointsRef.current = endpoints;

    const runCheck = useCallback(async (id: string, url: string) => {
        if (checksInProgress.current.has(id)) return;

        const controller = new AbortController();
        checksInProgress.current.set(id, controller);
        setEndpoints((current) => current.map((endpoint) =>
            endpoint.id === id ? { ...endpoint, isChecking: true } : endpoint,
        ));

        try {
            const result = await checkEndpointHealth(url, { signal: controller.signal });
            if (!controller.signal.aborted) {
                setEndpoints((current) => current.map((endpoint) =>
                    endpoint.id === id && endpoint.url === url
                        ? { ...endpoint, status: result.status, isChecking: false, lastCheck: result }
                        : endpoint,
                ));
            }
        } finally {
            if (checksInProgress.current.get(id) === controller) {
                checksInProgress.current.delete(id);
            }
        }
    }, []);

    const endpointSignature = endpoints.map(({ id, url }) => `${id}:${url}`).join('|');
    const savedConfig = JSON.stringify({
        version: 1,
        pollInterval,
        endpoints: endpoints.map(({ id, name, url }) => ({ id, name, url })),
    } satisfies SavedMonitorConfig);

    useEffect(() => {
        if (endpointsRef.current.length === 0) return;

        const checkAll = () => {
            endpointsRef.current.forEach((endpoint) => {
                void runCheck(endpoint.id, endpoint.url);
            });
        };

        checkAll();
        const timer = window.setInterval(checkAll, pollInterval * 1_000);
        return () => window.clearInterval(timer);
    }, [endpointSignature, pollInterval, runCheck]);

    useEffect(() => () => {
        checksInProgress.current.forEach((controller) => controller.abort());
        checksInProgress.current.clear();
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, savedConfig);
            setStorageError('');
        } catch {
            setStorageError('unavailable');
        }
    }, [savedConfig]);

    const addEndpoint = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const validated = validateEndpointInput(nameInput, urlInput);
        if (!validated.valid) {
            setFormError(labels.inputErrors[validated.error]);
            return;
        }
        if (endpoints.length >= MAX_ENDPOINTS) {
            setFormError(labels.tooManyEndpoints);
            return;
        }
        if (endpoints.some((endpoint) =>
            endpoint.name.toLocaleLowerCase() === validated.name.toLocaleLowerCase(),
        )) {
            setFormError(labels.duplicateName);
            return;
        }

        setEndpoints((current) => [
            ...current,
            makeEndpoint(createEndpointId(), validated.name, validated.url),
        ]);
        setNameInput('');
        setUrlInput('');
        setFormError('');
    };

    const removeEndpoint = (id: string) => {
        checksInProgress.current.get(id)?.abort();
        checksInProgress.current.delete(id);
        setEndpoints((current) => current.filter((endpoint) => endpoint.id !== id));
    };

    const healthyCount = endpoints.filter((endpoint) => endpoint.status === 'up').length;
    const unhealthyCount = endpoints.filter((endpoint) => endpoint.status === 'down').length;

    return (
        <section className="monitor-dashboard" aria-labelledby="monitor-title">
            <div className="monitor-heading">
                <div>
                    <h2 id="monitor-title">{labels.title}</h2>
                    <p>{labels.subtitle}</p>
                </div>
                <div className="monitor-interval">
                    <label htmlFor="monitor-interval">{labels.pollEvery}</label>
                    <select
                        id="monitor-interval"
                        value={pollInterval}
                        onChange={(event) => setPollInterval(Number(event.target.value) as PollInterval)}
                    >
                        {POLL_INTERVALS.map((seconds) => (
                            <option key={seconds} value={seconds}>{seconds} {labels.seconds}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="monitor-button monitor-button-secondary"
                        onClick={() => endpointsRef.current.forEach((endpoint) => {
                            void runCheck(endpoint.id, endpoint.url);
                        })}
                        disabled={endpoints.length === 0 || endpoints.every((endpoint) => endpoint.isChecking)}
                    >
                        {labels.refreshAll}
                    </button>
                </div>
            </div>

            <div className="monitor-summary" aria-label={labels.title}>
                <div className="monitor-stat">
                    <span>{labels.total}</span>
                    <Ticker value={endpoints.length} characterLists={Presets.NUMBER} duration={250} />
                </div>
                <div className="monitor-stat monitor-stat-up">
                    <span>{labels.healthy}</span>
                    <Ticker value={healthyCount} characterLists={Presets.NUMBER} duration={250} />
                </div>
                <div className="monitor-stat monitor-stat-down">
                    <span>{labels.failing}</span>
                    <Ticker value={unhealthyCount} characterLists={Presets.NUMBER} duration={250} />
                </div>
            </div>

            <form className="monitor-form" onSubmit={addEndpoint} noValidate>
                <div className="monitor-form-heading">{labels.addEndpoint}</div>
                <div className="monitor-form-fields">
                    <label>
                        <span>{labels.name}</span>
                        <input
                            type="text"
                            value={nameInput}
                            required
                            maxLength={MAX_ENDPOINT_NAME_LENGTH}
                            placeholder={labels.namePlaceholder}
                            onChange={(event) => {
                                setNameInput(event.target.value);
                                setFormError('');
                            }}
                        />
                    </label>
                    <label>
                        <span>{labels.url}</span>
                        <input
                            type="url"
                            value={urlInput}
                            required
                            maxLength={MAX_ENDPOINT_URL_LENGTH}
                            placeholder={labels.urlPlaceholder}
                            onChange={(event) => {
                                setUrlInput(event.target.value);
                                setFormError('');
                            }}
                        />
                    </label>
                    <button type="submit" className="monitor-button monitor-button-primary">
                        {labels.add}
                    </button>
                </div>
                {formError && <p className="monitor-form-error" role="alert">{formError}</p>}
            </form>

            {storageError && (
                <p className="monitor-storage-error" role="status">{labels.storageError}</p>
            )}

            {endpoints.length === 0 ? (
                <div className="monitor-empty">
                    <span aria-hidden="true">◉</span>
                    <strong>{labels.noEndpoints}</strong>
                    <p>{labels.noEndpointsHint}</p>
                </div>
            ) : (
                <ul className="monitor-list" aria-live="polite">
                    {endpoints.map((endpoint) => {
                        const statusClass = endpoint.isChecking
                            ? 'checking'
                            : endpoint.status;
                        const status = statusLabel(endpoint.status, endpoint.isChecking, labels);
                        const checkError = errorLabel(endpoint.lastCheck?.error, labels);

                        return (
                            <li className={`monitor-endpoint monitor-endpoint-${statusClass}`} key={endpoint.id}>
                                <span className="monitor-status-indicator" aria-hidden="true" />
                                <div className="monitor-endpoint-info">
                                    <div className="monitor-endpoint-title">
                                        <strong>{endpoint.name}</strong>
                                        <span className={`monitor-status-label monitor-status-label-${statusClass}`}>
                                            {status}
                                        </span>
                                    </div>
                                    <span className="monitor-endpoint-url" title={endpoint.url}>{endpoint.url}</span>
                                    {checkError && <span className="monitor-endpoint-error">{checkError}</span>}
                                    <span className="monitor-endpoint-meta">
                                        {endpoint.lastCheck
                                            ? `${labels.checked}: ${new Date(endpoint.lastCheck.checkedAt).toLocaleTimeString()}`
                                            : labels.neverChecked}
                                    </span>
                                </div>
                                <div className="monitor-endpoint-metrics">
                                    {endpoint.lastCheck?.httpStatus !== undefined && (
                                        <span className="monitor-http-status">HTTP {endpoint.lastCheck.httpStatus}</span>
                                    )}
                                    {endpoint.lastCheck && (
                                        <span className="monitor-latency">
                                            {endpoint.lastCheck.latencyMs} <small>ms</small>
                                        </span>
                                    )}
                                </div>
                                <div className="monitor-endpoint-actions">
                                    <button
                                        type="button"
                                        className="monitor-button monitor-button-secondary"
                                        onClick={() => void runCheck(endpoint.id, endpoint.url)}
                                        disabled={endpoint.isChecking}
                                    >
                                        {labels.checkNow}
                                    </button>
                                    <button
                                        type="button"
                                        className="monitor-remove"
                                        onClick={() => removeEndpoint(endpoint.id)}
                                        aria-label={`${labels.remove} ${endpoint.name}`}
                                    >
                                        {labels.remove}
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <p className="monitor-cors-note">{labels.corsNote}</p>
        </section>
    );
}
