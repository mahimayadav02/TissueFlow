import { Link } from 'react-router-dom';
import { Map } from 'lucide-react';
import { startTour } from '../../components/layout/Tour';
import { Button, Card, PageHeader } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { basePath } from '../../lib/paths';
import type { Role } from '../../lib/types';

/** What each role does, in order, with links to the pages. */
const STEPS: Record<Role, { text: string; to: string; link: string }[]> = {
  MANAGER: [
    { text: 'Set up the lab once: rooms, benches, crops, stages, media recipes and alert limits.', to: '/m/setup/lab', link: 'Lab set-up' },
    { text: 'Add your staff and give each supervisor their zones.', to: '/m/setup/users', link: 'Users' },
    { text: 'Start a batch from the samples collected, and print QR labels for its trays.', to: '/m/batches', link: 'Batches' },
    { text: 'Each day, follow work against target on the dashboard and the zone pages.', to: '/m/zones', link: 'All zones' },
    { text: 'See work done added up by day, then by operator, zone, work, batch or stage.', to: '/m/output', link: 'Work output' },
    { text: 'Enter the month’s costs; check orders against the forecast before saying yes.', to: '/m/orders', link: 'Orders' },
    { text: 'At month end, print or download the monthly report.', to: '/m/reports', link: 'Reports' },
  ],
  SUPERVISOR: [
    { text: 'At the start of the shift, mark who is present, on half day or absent.', to: '/s/attendance', link: 'Attendance' },
    { text: 'Give each present operator their work: batch and stage for sub-culture, bottles to wash, media to make, or bottles to check, with a target.', to: '/s/assign', link: 'Give work' },
    { text: 'During the day, watch your zones: work done, trays, losses and alerts.', to: '/s/zones', link: 'My zones' },
    { text: 'If an operator tells you their counts, record them yourself with Record work on Give work.', to: '/s/assign', link: 'Give work' },
    { text: 'At the end of the shift, verify each entry or send it back with a reason.', to: '/s/verify', link: 'Check entries' },
    { text: 'See the totals for any day or period, by operator, zone, batch or stage.', to: '/s/output', link: 'Work output' },
    { text: 'Record media lots and stock used, and acknowledge alerts you are dealing with.', to: '/s/media', link: 'Media and stock' },
  ],
  OPERATOR: [
    { text: 'Open Today to see the work your supervisor gave you.', to: '/o', link: 'Today' },
    { text: 'Before you sub-culture a tray, scan its label (or type its code).', to: '/o/scan', link: 'Scan tray' },
    { text: 'Enter the new bottles made and any lost, then stick the new tray codes on the new trays.', to: '/o/scan', link: 'Scan tray' },
    { text: 'No label to scan, or washing, media or checking work? Type the batch, stage and bottles by hand.', to: '/o/enter', link: 'Record work' },
    { text: 'Found contaminated bottles? Report them with the cause.', to: '/o/loss', link: 'Report loss' },
    { text: 'Check My work to see all your work, day by day; an entry sent back shows its reason on Today.', to: '/o/output', link: 'My work' },
  ],
};

const TERMS: [string, string][] = [
  ['Batch', 'All the bottles started from one month’s samples. Its code is B, the month and the year: B1-26 is January 2026. A split part gets a letter, like B1-26A.'],
  ['Tray', 'Up to 30 bottles of one batch at one stage, with one QR label. Bottles are not labelled one by one.'],
  ['Stage codes', 'I1–I3 initiation, M1–M8 multiplication rounds, R1–R2 rooting, PH primary hardening, SH secondary hardening.'],
  ['Sub-culture', 'Moving shoots from a bottle into new bottles with fresh medium. One sub-culture of one bottle is one bottle-round.'],
  ['Growth', 'New bottles made for every good bottle sub-cultured, from the batch’s own history. 2.5 means 10 bottles became 25.'],
  ['Target and achieved', 'The bottles a supervisor asked an operator to handle in a day, and the share they actually handled.'],
  ['Overdue tray', 'A tray that has stayed in one stage longer than the limit set in Alert limits.'],
  ['Verified entry', 'An operator’s entry the supervisor has checked. Only verified and pending entries count; sent-back ones do not.'],
  ['Media lot', 'One batch of culture medium made from a recipe, with the date it was made and the date it must be used by.'],
  ['Cost per bottle-round', 'The month’s costs divided by the bottles handled that month. It is how a batch’s cost is worked out.'],
  ['Expected plants', 'Bottles now × growth for each round left × rooting survival × hardening survival.'],
  ['Zone', 'A room or area of the lab, such as washing, inoculation or the growth room. Supervisors look after zones; an operator can work in two.'],
  ['Bottles to be washed', 'Every bottle emptied at sub-culture goes to the wash area count by itself; contaminated bottles are counted separately.'],
  ['Media code and batch code', 'The media code is the recipe (MU-01 to MU-03 multiplication, RO-01 to RO-03 rooting). The batch code (like B0001/26) names one lot of media made.'],
  ['Typed-in entry', 'Work entered by hand instead of a scan. For sub-culture, the bottles are taken from that batch and stage’s oldest trays.'],
];

const FAQ: [string, string][] = [
  ['Why does it say “Sample data”?', 'The site runs on made-up records of a demo lab until the server and database are connected. Changes you make stay in your own browser.'],
  ['A tray I scanned says it is not found or not in my zone.', 'Check the code on the label. Operators can open trays of the batches they were given today; ask your supervisor to give you that batch.'],
  ['My entry was sent back. What now?', 'Read the reason on your Today screen, scan the tray again and enter it correctly. If the new trays were not touched, the old entry was undone for you.'],
  ['Why did the forecast change?', 'It is worked out again from the records every time: new sub-cultures change the growth, and losses change the bottles left.'],
  ['Can I use the camera to scan?', 'Yes, on the live site (it uses https). Allow the camera when the browser asks. You can always type the code instead.'],
  ['I forgot my password.', 'Use “Forgot password?” on the sign-in page, or ask your manager to reset it.'],
];

export default function Help() {
  const { user } = useAuth();
  if (!user) return null;
  const base = basePath(user);
  return (
    <>
      <PageHeader title="Help and guide" subtitle="How to use TissueFlow in your role, what its words mean, and answers to common questions." actions={<Button variant="secondary" onClick={startTour}><Map size={16} /> Take the tour</Button>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="Your day, step by step">
          <ol className="flex flex-col gap-3">
            {STEPS[user.role].map((s, i) => (
              <li key={i} className="flex gap-3 text-[15px]">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-forest text-xs font-semibold text-white">{i + 1}</span>
                <span className="leading-relaxed">{s.text} <Link to={s.to} className="font-semibold text-forest-700 underline">{s.link}</Link></span>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Common questions">
          <div className="flex flex-col divide-y divide-[#E6ECE8]">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-2.5">
                <summary className="focus-ring cursor-pointer list-none rounded text-[15px] font-medium text-ink marker:hidden">
                  <span className="mr-2 inline-block text-forest-600 transition-transform group-open:rotate-90">›</span>{q}
                </summary>
                <p className="mt-1.5 pl-5 text-sm leading-relaxed text-ink-muted">{a}</p>
              </details>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Words used in TissueFlow" className="mt-5">
        <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          {TERMS.map(([t, d]) => (
            <div key={t}>
              <dt className="text-[15px] font-semibold text-ink">{t}</dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-ink-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <p className="mt-5 text-sm text-ink-muted">Still stuck? {user.role === 'OPERATOR' ? 'Ask your supervisor.' : user.role === 'SUPERVISOR' ? 'Ask your manager.' : 'Check the page help on each page.'} <Link to={base} className="font-semibold text-forest-700 underline">Back to your home page</Link></p>
    </>
  );
}
