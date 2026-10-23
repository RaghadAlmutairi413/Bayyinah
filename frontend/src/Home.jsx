import { useEffect, useRef, useState } from 'react';
import SiteHeader from './SiteHeader.jsx';
import SiteFooter from './SiteFooter.jsx';

// Landing page. The header, hero and feature strip keep the original Bayyinah design.
// Everything after the feature strip is new: an animated burnout section, survey numbers,
// how it works, about us, FAQ and a closing call to action.

// ---------- Small helpers ----------

// Adds the class "in" to an element the first time it scrolls into view.
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (!('IntersectionObserver' in window)) {
      node.classList.add('in');
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        node.classList.add('in');
        observer.disconnect();
      }
    }, { threshold: 0.15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}

// Smoothly counts from the current number to the target.
function useAnimatedNumber(target, duration = 1100) {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setValue(target);
      from.current = target;
      return undefined;
    }
    const start = performance.now();
    const begin = from.current;
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const next = begin + (target - begin) * eased;
      from.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function Reveal({ as: Tag = 'div', className = '', delay = 0, children, ...rest }) {
  const ref = useReveal();
  return (
    <Tag ref={ref} className={`mk-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }} {...rest}>
      {children}
    </Tag>
  );
}

// ---------- Hero: the original floating cards, now showing burnout insights one after another ----------

const POPS_TOP = [
  ['✦', 'Role-based access', 'Relevant information for each role'],
  ['!', 'Burnout risk rising', 'Omar K. is at 82% after 3 overdue tasks'],
  ['↗', 'Workload imbalance', 'Engineering has 40% more open tasks'],
];
const POPS_BOTTOM = [
  ['✓', 'Employee invited', 'Secure account setup is ready'],
  ['✓', 'Risk reduced', 'Lina F. dropped to 24% after rebalancing'],
  ['✦', 'Suggested assignee', 'Amal H. has capacity for this task'],
];

function FloatingPop({ items, className, offset = 0 }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;
    let timer;
    const start = setTimeout(() => {
      timer = setInterval(() => setIndex((value) => value + 1), 4200);
    }, offset);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [offset]);
  const [icon, title, text] = items[index % items.length];
  return (
    <div className={`floating-card ${className}`} aria-hidden="true">
      <div key={index} className="mk-pop">
        <span className={icon === '✓' ? 'float-check' : 'float-icon'}>{icon}</span>
        <span><b>{title}</b><small>{text}</small></span>
      </div>
    </div>
  );
}

// ---------- Burnout section ----------

const SCENES = [
  {
    key: 'predict',
    label: 'Predict',
    sub: 'A risk level for every employee',
    score: 82,
    level: 'High risk',
    note: 'Updated as work changes',
  },
  {
    key: 'explain',
    label: 'Explain',
    sub: 'The reasons behind each score',
    score: 82,
    level: 'High risk',
    note: 'Top factors behind the score',
  },
];

const FACTORS = [
  ['Overdue tasks', 90, '+31', 'up'],
  ['Overtime hours', 66, '+22', 'up'],
  ['Meeting load', 42, '+14', 'up'],
  ['Days off taken', 24, '−8', 'down'],
];

function Gauge({ score }) {
  const value = useAnimatedNumber(score);
  const level = value >= 70 ? 'high' : value >= 40 ? 'med' : 'low';
  // The needle is drawn with plain coordinates (no CSS transform), so it always shows.
  const radians = Math.PI - (Math.min(100, value) / 100) * Math.PI;
  const tipX = 110 + 76 * Math.cos(radians);
  const tipY = 110 - 76 * Math.sin(radians);
  return (
    <div className={`mk-gauge mk-gauge-${level}`} role="img" aria-label={`Burnout risk ${score} percent`}>
      <svg viewBox="0 0 220 125">
        <defs>
          <linearGradient id="mk-grad" gradientUnits="userSpaceOnUse" x1="20" x2="200" y1="0" y2="0">
            <stop offset="0" stopColor="#34775b" />
            <stop offset="0.5" stopColor="#ec6a1a" />
            <stop offset="1" stopColor="#d92d20" />
          </linearGradient>
        </defs>
        <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="#efe9f3" strokeWidth="18" strokeLinecap="round" />
        <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="url(#mk-grad)" strokeWidth="18" strokeLinecap="round" opacity="0.95" />
        <line x1="110" y1="110" x2={tipX} y2={tipY} stroke="#fff" strokeWidth="8" strokeLinecap="round" />
        <line x1="110" y1="110" x2={tipX} y2={tipY} stroke="#311442" strokeWidth="4" strokeLinecap="round" />
        <circle cx="110" cy="110" r="10" fill="#311442" stroke="#fff" strokeWidth="2" />
        <circle cx="110" cy="110" r="3.5" fill="#fff" />
      </svg>
      <strong>{Math.round(value)}<span>%</span></strong>
    </div>
  );
}

function BurnoutScene() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const scene = SCENES[active];

  // The reveal wrapper keeps a fixed className. Before, the className changed on hover,
  // React reset it, and the "in" class was lost, so the whole section turned invisible.
  return (
    <Reveal>
    <div
      className={`mk-burnout${paused ? ' is-paused' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mk-tabs" role="tablist" aria-label="Burnout features">
        {SCENES.map((item, index) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            className="mk-tab"
            aria-selected={active === index}
            onClick={() => setActive(index)}
          >
            <span className="mk-tab-num">{index + 1}</span>
            <span className="mk-tab-text"><b>{item.label}</b><small>{item.sub}</small></span>
            {active === index && (
              <i
                key={`${item.key}-${paused}`}
                className="mk-tab-progress"
                onAnimationEnd={() => setActive((value) => (value + 1) % SCENES.length)}
              />
            )}
          </button>
        ))}
      </div>

      <div className="mk-stage" role="tabpanel">
        <div className="mk-stage-person">
          <span className="mk-risk-avatar">OK</span>
          <div><b>Omar Khalid</b><small>Operations</small></div>
          <span className={`mk-level mk-level-${scene.score >= 70 ? 'high' : 'low'}`}>{scene.level}</span>
        </div>

        <div className="mk-stage-body">
          <div className="mk-stage-gauge">
            <Gauge score={scene.score} />
            <p className="mk-stage-note" key={scene.key}>{scene.note}</p>
          </div>

          <div className="mk-stage-side" key={scene.key}>
            {scene.key === 'predict' && (
              <ul className="mk-people">
                {[['Omar Khalid', 82, 'High'], ['Amal Hassan', 56, 'Medium'], ['Lina Faisal', 24, 'Low']].map(([name, value, level], index) => (
                  <li key={name} style={{ animationDelay: `${index * 140}ms` }}>
                    <span>{name}</span>
                    <i><b className={`lv-${level.toLowerCase()}`} style={{ width: `${value}%`, animationDelay: `${index * 140 + 200}ms` }} /></i>
                    <em>{level}</em>
                  </li>
                ))}
              </ul>
            )}
            {scene.key === 'explain' && (
              <ul className="mk-factors">
                {FACTORS.map(([name, width, value, dir], index) => (
                  <li key={name} style={{ animationDelay: `${index * 160}ms` }}>
                    <span>{name}</span>
                    <i><b className={dir} style={{ width: `${width}%`, animationDelay: `${index * 160 + 200}ms` }} /></i>
                    <em>{value}</em>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
    </Reveal>
  );
}

// ---------- Numbers from our own survey ----------

function CountUp({ to, suffix = '%' }) {
  const ref = useRef(null);
  const [go, setGo] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || !('IntersectionObserver' in window)) {
      setGo(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setGo(true);
        observer.disconnect();
      }
    }, { threshold: 0.4 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const value = useAnimatedNumber(go ? to : 0, 1400);
  return <span ref={ref}>{Math.round(value)}{suffix}</span>;
}

const FACTS = [
  [91, 'of surveyed employees feel work stress or burnout at least sometimes'],
  [30, 'of HR and managers have no systematic way to spot burnout'],
  [88, 'of employees rate one central system for tasks as very or extremely useful'],
];

// ---------- Content ----------

const STEPS = [
  ['Set up', 'HR imports the team from a CSV file. Everyone gets a private invite.'],
  ['Work together', 'Managers assign tasks and review progress. Employees update their status.'],
  ['Act early', 'Bayyinah flags burnout risk with the reasons, so you can rebalance work.'],
];

const PILLARS = [
  ['✦', 'Burnout prediction', 'A risk level for every employee, with the reasons behind it.'],
  ['⇄', 'Fair workload', 'Assign tasks with each person’s capacity and skills in view.'],
  ['◎', 'Goals and KPIs', 'Set goals, link them to tasks and track progress automatically.'],
  ['▦', 'Clear dashboards', 'Compare workload and performance across departments.'],
];

const FAQ = [
  ['What does burnout prediction do?', 'It estimates each employee’s burnout risk from work data like workload, tasks, meetings and attendance, and shows it as low, medium or high. It is a risk estimate, not a diagnosis.'],
  ['Why is a person marked at risk?', 'Every score lists the top factors that raised or lowered it, so managers can see what to change.'],
  ['Who sees what?', 'HR sees the organization, managers see their department, and employees see their own information.'],
  ['How do employees join?', 'HR adds them one by one or imports a CSV file. Each person gets an email invitation and sets their own password.'],
];

export default function Home() {
  return (
    <div className="marketing-page mk-page">
      <SiteHeader />

      <main id="main">
        {/* ---------- Original hero ---------- */}
        <section className="hero">
          <div className="hero-copy">
            <span className="pill"><span className="pill-dot" /> People operations, made clearer</span>
            <h1>Bring your people and work <span>into focus.</span></h1>
            <p>
              Bayyinah brings HR professionals, managers, and employees together
              in one welcoming, organized space. Work better as a team and stay
              connected every step of the way.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/setup">Set up your organization <span aria-hidden="true">→</span></a>
              <a className="button button-quiet" href="/login">I already have an account</a>
            </div>
            <div className="hero-trust">
              <span className="trust-check">✓</span>
              Role-aware access
              <span className="trust-separator">·</span>
              Simple employee onboarding
            </div>
          </div>

          <div className="hero-art" aria-label="Preview of an employee operations dashboard">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="preview-window">
              <div className="preview-topbar">
                <div className="preview-brand"><img className="preview-logo" src="/bayyinah-logo.png" alt="" /> Bayyinah</div>
                <div className="preview-avatar">HR</div>
              </div>
              <div className="preview-body">
                <div className="preview-sidebar">
                  <span className="side-active">Overview</span>
                  <span>Dashboards</span>
                  <span>People</span>
                  <span>Departments</span>
                  <span>Reports</span>
                </div>
                <div className="preview-main">
                  <div className="preview-heading">
                    <div><small>ILLUSTRATIVE WORKSPACE PREVIEW</small><strong>Your people overview</strong></div>
                    <span className="preview-action">+ Add employee</span>
                  </div>
                  <div className="preview-metrics">
                    <div><small>Total employees</small><strong>128</strong><i className="metric-line line-purple" /></div>
                    <div><small>Departments</small><strong>8</strong><i className="metric-line line-orange" /></div>
                    <div><small>Invitations</small><strong>12</strong><i className="metric-line line-green" /></div>
                  </div>
                  <div className="preview-table">
                    <div className="table-title">Recent employees <span>View all</span></div>
                    <div className="preview-person"><i className="person-dot dot-lilac" /><span><b>Amal Hassan</b><small>Engineering</small></span><em>Employee</em></div>
                    <div className="preview-person"><i className="person-dot dot-peach" /><span><b>Omar Khalid</b><small>Operations</small></span><em className="role-manager">Manager</em></div>
                    <div className="preview-person"><i className="person-dot dot-mint" /><span><b>Lina Faisal</b><small>People & Culture</small></span><em>Employee</em></div>
                  </div>
                </div>
              </div>
            </div>
            <FloatingPop items={POPS_TOP} className="float-top" />
            <FloatingPop items={POPS_BOTTOM} className="float-bottom" offset={2100} />
          </div>
        </section>

        {/* ---------- Original feature strip ---------- */}
        <section className="feature-strip" aria-label="Platform benefits">
          <article><span className="feature-icon feature-purple">◎</span><div><strong>Organized employee records</strong><p>Keep employee and department information together.</p></div></article>
          <article><span className="feature-icon feature-orange">↗</span><div><strong>Role-based workspaces</strong><p>Give HR, managers, and employees relevant access.</p></div></article>
          <article><span className="feature-icon feature-green">✳</span><div><strong>Guided onboarding</strong><p>Review imported records before sending invitations.</p></div></article>
        </section>

        {/* ---------- Burnout feature ---------- */}
        <section className="mk-section" id="burnout">
          <div className="mk-wrap">
            <Reveal className="mk-head">
              <span className="mk-eyebrow">New feature</span>
              <h2 className="mk-h2">See burnout before it costs you <span>someone good.</span></h2>
              <p className="mk-lead">Bayyinah predicts each employee’s burnout risk and shows the reasons behind it.</p>
            </Reveal>
            <BurnoutScene />
          </div>
        </section>

        {/* ---------- Survey numbers ---------- */}
        <section className="mk-facts" aria-label="Why it matters">
          <div className="mk-wrap">
            <div className="mk-facts-grid">
              {FACTS.map(([value, text], index) => (
                <Reveal className="mk-fact" key={text} delay={index * 120}>
                  <strong><CountUp to={value} /></strong>
                  <span>{text}</span>
                </Reveal>
              ))}
            </div>
            <p className="mk-source">Source: Bayyinah requirements survey, 62 employees, managers and HR professionals.</p>
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section className="mk-section" id="how">
          <div className="mk-wrap">
            <Reveal className="mk-head">
              <span className="mk-eyebrow">How it works</span>
              <h2 className="mk-h2">Three steps to a healthier team.</h2>
            </Reveal>
            <div className="mk-steps">
              {STEPS.map(([title, text], index) => (
                <Reveal as="article" className="mk-step" key={title} delay={index * 120}>
                  <span className="mk-step-num">{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- About ---------- */}
        <section className="mk-section mk-about" id="about">
          <div className="mk-wrap">
            <Reveal className="mk-head">
              <span className="mk-eyebrow">About Bayyinah</span>
              <h2 className="mk-h2">One workspace for work and wellbeing.</h2>
              <p className="mk-lead">
                Bayyinah helps HR teams and managers understand how work affects people,
                and step in early when it starts to hurt.
              </p>
            </Reveal>
            <div className="mk-pillars">
              {PILLARS.map(([icon, title, text], index) => (
                <Reveal as="article" className="mk-pillar" key={title} delay={index * 100}>
                  <span className="mk-pillar-icon" aria-hidden="true">{icon}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section className="mk-section" id="faq">
          <div className="mk-wrap mk-faq">
            <Reveal className="mk-head">
              <span className="mk-eyebrow">FAQ</span>
              <h2 className="mk-h2">Quick answers.</h2>
            </Reveal>
            <Reveal className="mk-faq-list" delay={120}>
              {FAQ.map(([question, answer]) => (
                <details className="mk-faq-item" key={question}>
                  <summary>{question}</summary>
                  <p>{answer}</p>
                </details>
              ))}
            </Reveal>
          </div>
        </section>

        {/* ---------- Closing call to action ---------- */}
        <div className="mk-wrap">
          <Reveal as="section" className="mk-cta">
            <h2>Spot burnout before it spreads.</h2>
            <p>Set up your organization in minutes.</p>
            <div className="hero-actions">
              <a className="button button-orange" href="/setup">Get started <span aria-hidden="true">→</span></a>
              <a className="button mk-cta-quiet" href="/login">Log in</a>
            </div>
          </Reveal>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
