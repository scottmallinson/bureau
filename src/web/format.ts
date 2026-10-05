/** Date and number formatting. Everything renders in the browser's time zone. */

const DAY = 86_400_000;

export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7; // Monday first
  d.setDate(d.getDate() - offset);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });
const longFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const rangeFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export const formatTime = (iso: string) => timeFormat.format(new Date(iso));
export const formatDay = (date: Date) => dayFormat.format(date);
export const formatDateTime = (iso: string) => longFormat.format(new Date(iso));
export const formatDate = (date: Date) => rangeFormat.format(date);

/** ISO → value for `<input type="datetime-local">` in local time. */
export function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `<input type="datetime-local">` value → ISO, or undefined when empty/invalid. */
export function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function relative(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / DAY), 'day');
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();

export const formatCount = (n: number) => (n >= 10_000 ? compact.format(n) : whole.format(n));
export const formatWhole = (n: number) => whole.format(n);
export const formatRate = (r: number | undefined) =>
  r === undefined ? '–' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;

export function formatDelta(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const abs = Math.abs(ms);
  const days = Math.floor(abs / DAY);
  const hours = Math.round((abs % DAY) / 3_600_000);
  if (days && hours) return `${sign}${days}d ${hours}h`;
  if (days) return `${sign}${days}d`;
  return `${sign}${hours}h`;
}
