import { Link } from 'react-router-dom';
import {
  AlertTriangle, BarChart3, Bug, ClipboardCheck, FlaskConical, IndianRupee, LayoutGrid, QrCode, Thermometer,
} from 'lucide-react';
import { HOME_OF, useAuth } from '../../lib/auth';
import { HeroBottles } from './HeroBottles';
import { PublicLayout } from './PublicLayout';

/** The path a batch takes through the lab. A real sequence, so it is numbered. */
const STAGES = [
  { code: 'I1–I3', name: 'Initiation', time: 'about 30–45 days a stage', what: 'Explants from the mother plant are started in culture. Each sample gets its batch code.' },
  { code: 'M1–M8', name: 'Multiplication', time: 'about 30–45 days a round', what: 'Shoots are split into new bottles every round. Trays carry a QR label; every round is counted.' },
  { code: 'R1–R2', name: 'Rooting', time: 'about 30–45 days a stage', what: 'Shoots grow roots on rooting media. Losses are recorded with their cause.' },
  { code: 'PH', name: 'Primary hardening', time: 'about 30–45 days', what: 'Plantlets leave the bottle and get used to air and light under shade.' },
  { code: 'SH', name: 'Secondary hardening', time: 'about 60–90 days', what: 'Plants grow on in polybags in the net house until they are ready to sell.' },
  { code: 'Dispatch', name: 'Dispatch', time: 'against an order', what: 'Plants are sent to farmers and nurseries; each order is checked against the forecast first.' },
];

const MODULES = [
  { icon: QrCode, title: 'Batches, trays and QR labels', text: 'Every tray of 25–30 bottles has a QR label. Scan it to see its batch, stage, bench and history.' },
  { icon: ClipboardCheck, title: 'Daily work and attendance', text: 'Supervisors mark attendance and give each operator a target; operators record what they did; supervisors verify it.' },
  { icon: Bug, title: 'Contamination', text: 'Bottles lost are recorded with the cause: lab, operator, season or media lot, so the pattern shows early.' },
  { icon: FlaskConical, title: 'Media and stock', text: 'Media lots with use-by dates, chemicals and bottles in stock, and a warning before anything runs out.' },
  { icon: BarChart3, title: 'Forecast and profit', text: 'How many plants each batch will give and when, what it will cost, and what it will earn.' },
  { icon: IndianRupee, title: 'Orders and costs', text: 'Before saying yes to a customer, check whether the plants will be ready by their date.' },
  { icon: Thermometer, title: 'Room monitoring', text: 'Temperature and humidity of the growth room from a small sensor node, with limits drawn in.' },
  { icon: LayoutGrid, title: 'Zones', text: 'One page that combines every zone, and a page for each: washing, media, inoculation, growth room, hardening.' },
  { icon: AlertTriangle, title: 'Alerts, reports and audit', text: 'Alerts when a limit is crossed, daily and monthly reports to print or download, and a record of every change.' },
];

export default function Landing() {
  const { user } = useAuth();
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="border-b border-line bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_520px] lg:py-20">
          <div>
            <p className="text-sm font-medium text-forest-600">For plant tissue culture labs</p>
            <h1 className="mt-3 font-display text-[40px] font-semibold leading-[1.08] tracking-tight text-forest sm:text-[52px]">
              Every culture bottle, traced from mother plant to dispatch.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">
              TissueFlow runs a lab day to day: batches and trays with QR labels, each operator’s target and output, contamination by cause,
              media and stock, and a forecast of how many plants will be ready, and when.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={user ? HOME_OF[user.role] : '/login'} className="focus-ring inline-flex min-h-[48px] items-center rounded-lg bg-forest-700 px-6 text-[15px] font-semibold text-white hover:bg-forest-600">
                {user ? 'Open your dashboard' : 'Sign in'}
              </Link>
              <a href="#how" className="focus-ring inline-flex min-h-[48px] items-center rounded-lg border border-[#B5CDBF] bg-white px-6 text-[15px] font-semibold text-forest-700 hover:border-forest-500">
                See how a batch moves
              </a>
            </div>
            <p className="mt-6 text-sm text-ink-muted">A final-year B.Tech CSE project at IGDTUW, guided by Prof. SRN Reddy.</p>
          </div>
          <HeroBottles />
        </div>
      </section>

      {/* Before and after */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-display text-[28px] font-semibold tracking-tight text-forest">From a register and an Excel sheet to one live record</h2>
        <p className="mt-2 max-w-2xl text-ink-muted">Most small and medium labs keep one spreadsheet per batch and count bottles by hand. That works until someone asks a question.</p>
        <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-white">
          <div className="hidden grid-cols-[1fr_1fr] border-b border-line bg-paper/70 text-sm font-semibold sm:grid">
            <div className="px-5 py-3 text-ink-muted">The question</div>
            <div className="border-l border-line px-5 py-3 text-forest-700">With TissueFlow</div>
          </div>
          {[
            ['How many bottles of B1 are in M6, and where?', 'Scan any tray, or open the batch: bottles by stage, tray by tray, bench by bench.'],
            ['Did each operator meet today’s target?', 'Target against bottles handled, per operator and per zone, the same day.'],
            ['Why are we losing bottles this month?', 'Losses by cause, stage, zone and media lot, with an alert when a limit is crossed.'],
            ['Can we give 5,000 plants by March?', 'The order check adds up what every running batch will give by that date.'],
            ['What did a plant actually cost us?', 'Monthly costs spread over the bottles handled give a cost per bottle-round and per plant.'],
          ].map(([q, a]) => (
            <div key={q} className="grid grid-cols-1 border-b border-[#E6ECE8] text-[15px] last:border-0 sm:grid-cols-[1fr_1fr]">
              <div className="px-5 pb-1 pt-4 font-semibold text-ink sm:py-4 sm:font-normal">{q}</div>
              <div className="border-[#E6ECE8] px-5 pb-4 text-ink-muted sm:border-l sm:py-4">{a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How a batch moves */}
      <section id="how" className="scroll-mt-20 border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-[28px] font-semibold tracking-tight text-forest">How a batch moves through the lab</h2>
          <p className="mt-2 max-w-2xl text-ink-muted">Six stages from a mother plant to a hardened plant. The system records each one, so nothing has to be counted twice.</p>
          <ol className="mt-10 grid gap-x-6 gap-y-8 md:grid-cols-3 lg:grid-cols-6">
            {STAGES.map((s, i) => (
              <li key={s.code} className="relative">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-forest text-sm font-semibold text-white">{i + 1}</span>
                  {i < STAGES.length - 1 && <span className="hidden h-px flex-1 bg-[#B5CDBF] lg:block" aria-hidden />}
                </div>
                <div className="mt-3 font-mono text-xs text-forest-600">{s.code}</div>
                <h3 className="mt-0.5 text-[15px] font-semibold text-ink">{s.name}</h3>
                <p className="mt-1 text-xs text-ink-muted">{s.time}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.what}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
        <h2 className="font-display text-[28px] font-semibold tracking-tight text-forest">Three people, three screens</h2>
        <p className="mt-2 max-w-2xl text-ink-muted">Each person signs in and sees only what their job needs. A supervisor sees their own zones; an operator sees their own work.</p>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            { role: 'Manager', device: 'On a laptop', points: ['Sets up rooms, benches, crops, stages and staff', 'Watches every zone, batch and operator', 'Checks orders, forecasts, costs and profit', 'Reads reports and the audit log'] },
            { role: 'Supervisor', device: 'On a tablet', points: ['Marks attendance at the start of the shift', 'Gives each operator a batch, stage and target', 'Checks and verifies the day’s entries', 'Looks after media, stock and alerts in their zones'] },
            { role: 'Operator', device: 'On a phone', points: ['Sees today’s work and target', 'Scans a tray and records the sub-culture', 'Reports contaminated bottles', 'Follows their own output and attendance'] },
          ].map((r) => (
            <div key={r.role} className="rounded-2xl border border-line bg-white p-6">
              <h3 className="font-display text-xl font-semibold tracking-tight text-forest">{r.role}</h3>
              <p className="text-sm text-ink-muted">{r.device}</p>
              <ul className="mt-4 space-y-2 text-[15px] text-ink">
                {r.points.map((p) => <li key={p} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-forest-500" aria-hidden />{p}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="scroll-mt-20 border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-[28px] font-semibold tracking-tight text-forest">What it covers</h2>
          <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m) => (
              <div key={m.title} className="flex gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest-700"><m.icon size={20} /></span>
                <div>
                  <h3 className="text-[15px] font-semibold text-ink">{m.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{m.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Monitoring */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid items-center gap-8 rounded-2xl bg-forest p-8 text-white md:grid-cols-[1fr_auto] md:p-10">
          <div>
            <h2 className="font-display text-[26px] font-semibold tracking-tight text-white">The growth room, watched all day</h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-[#CFE6DA]">
              A small ESP32 board with a DHT22 sensor reads the growth room’s temperature and humidity every few minutes. When a reading
              stays outside its limit, the supervisor of that room gets an alert. Until the node is installed, the site shows sample readings.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-white/10 px-5 py-4"><div className="text-xs text-[#9FD3B8]">Temperature</div><div className="mt-1 text-2xl font-semibold tabular-nums">24.6 °C</div></div>
            <div className="rounded-xl bg-white/10 px-5 py-4"><div className="text-xs text-[#9FD3B8]">Humidity</div><div className="mt-1 text-2xl font-semibold tabular-nums">68 %</div></div>
            <p className="col-span-2 text-xs text-[#8FB3A4]">Sample values</p>
          </div>
        </div>
      </section>

      {/* Project */}
      <section className="border-t border-line bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="font-display text-[24px] font-semibold tracking-tight text-forest">The project</h2>
            <p className="mt-3 leading-relaxed text-ink-muted">
              TissueFlow is the IoT Enabled Automated Tissue Management System, a final-year B.Tech project of the Department of Computer Science and
              Engineering, Indira Gandhi Delhi Technical University for Women, guided by Prof. SRN Reddy.
            </p>
            <Link to="/about" className="mt-4 inline-block text-sm font-semibold text-forest-700 underline">More about the project</Link>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Team</h3>
            <ul className="mt-2 grid grid-cols-2 gap-2 text-[15px] text-ink">
              <li>Kanika Chouhan</li><li>Khushi Chaudhary</li><li>Mahima Yadav</li><li>Jasman Kaur</li>
            </ul>
            <h3 className="mt-6 text-sm font-semibold text-ink">Guide</h3>
            <p className="mt-2 text-[15px] text-ink">Prof. SRN Reddy, Head of Department, Computer Science and Engineering</p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
