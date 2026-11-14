import { Link } from 'react-router-dom';
import { PublicLayout } from './PublicLayout';

const STACK = [
  ['Website', 'React, TypeScript and Tailwind CSS, hosted on Vercel'],
  ['Server', 'Node.js with Express (being built)'],
  ['Database', 'PostgreSQL (being built)'],
  ['Sensor node', 'ESP32 with a DHT22 temperature and humidity sensor'],
  ['Code', 'GitHub, with every change deployed automatically'],
];

/** About the project: what it is, where it stands, how it is built, and who made it. */
export default function About() {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <p className="text-sm font-medium text-forest-600">About the project</p>
        <h1 className="mt-2 font-display text-[36px] font-semibold leading-tight tracking-tight text-forest">IoT Enabled Automated Tissue Management System</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-muted">
          TissueFlow is a web system for plant tissue culture labs. It keeps one record for every batch and tray, from the first explant
          to the plant that leaves the net house, and turns the lab’s daily counts into targets, loss analysis, forecasts and costs.
        </p>

        <h2 className="mt-12 text-xl font-semibold text-ink">Why it was built</h2>
        <p className="mt-3 leading-relaxed text-ink-muted">
          Small and medium labs track production in registers and one spreadsheet per batch. Counts are entered late, contamination is
          noticed after it has spread, and nobody can say with confidence how many plants will be ready for an order. The project brings
          those records into one place that every role can use from a phone, tablet or laptop.
        </p>

        <h2 className="mt-10 text-xl font-semibold text-ink">Where it stands</h2>
        <ul className="mt-3 space-y-2 leading-relaxed text-ink-muted">
          <li><span className="font-semibold text-ink">Website:</span> every screen for the manager, supervisor and operator is built and online, running on sample data.</li>
          <li><span className="font-semibold text-ink">Server and database:</span> in progress. Real accounts, real lab data and live updates come with it.</li>
          <li><span className="font-semibold text-ink">Sensor node:</span> planned. Room monitoring shows sample readings until it is installed.</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold text-ink">How it is built</h2>
        <dl className="mt-4 divide-y divide-[#E6ECE8] rounded-2xl border border-line bg-white">
          {STACK.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[140px_1fr] gap-4 px-5 py-3 text-[15px]">
              <dt className="font-semibold text-ink">{k}</dt>
              <dd className="text-ink-muted">{v}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-10 text-xl font-semibold text-ink">Team</h2>
        <p className="mt-3 leading-relaxed text-ink-muted">
          Kanika Chouhan, Khushi Chaudhary, Mahima Yadav and Jasman Kaur, final-year B.Tech students of Computer Science and Engineering
          at Indira Gandhi Delhi Technical University for Women (IGDTUW), Delhi.
        </p>
        <h2 className="mt-8 text-xl font-semibold text-ink">Guide</h2>
        <p className="mt-3 leading-relaxed text-ink-muted">Prof. SRN Reddy, Head of Department, Computer Science and Engineering, IGDTUW.</p>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link to="/login" className="focus-ring inline-flex min-h-[44px] items-center rounded-lg bg-forest-700 px-5 text-sm font-semibold text-white hover:bg-forest-600">Sign in</Link>
          <a href="https://github.com/mahimayadav02/TissueFlow" target="_blank" rel="noreferrer" className="focus-ring inline-flex min-h-[44px] items-center rounded-lg border border-[#B5CDBF] bg-white px-5 text-sm font-semibold text-forest-700 hover:border-forest-500">View the source code</a>
        </div>
      </article>
    </PublicLayout>
  );
}
