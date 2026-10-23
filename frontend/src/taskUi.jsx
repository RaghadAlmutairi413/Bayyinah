import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, displayName, responseData } from './api.js';

export const PRIORITIES = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
];

export const STATUSES = [
  ['todo', 'To Do'],
  ['in_progress', 'In Progress'],
  ['completed', 'Completed'],
];

export function labelOf(list, value) {
  const found = list.find((item) => item[0] === value);
  return found ? found[1] : value;
}

// Today as YYYY-MM-DD, the same format the API uses for dates.
export function today() {
  return new Date().toLocaleDateString('en-CA');
}

export async function getJson(path) {
  return responseData(await apiRequest(path));
}

export async function sendJson(path, method, body) {
  const response = await apiRequest(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return responseData(response);
}

// ---------- Task rules: names, sorting and filtering (the backend decides what is allowed) ----------

const STATUS_ORDER = STATUSES.map(([value]) => value);

const PRIORITY_RANK = ['urgent', 'high', 'medium', 'low']; // most urgent first

// The button an employee presses to move their task forward, keyed by the CURRENT status.
// The backend sends `next_status`; this only decides how the button is worded.
export const EMPLOYEE_ACTIONS = {
  todo: { label: 'Start work', icon: 'play' },
  in_progress: { label: 'Submit for review', icon: 'send' },
  changes_requested: { label: 'Start working on changes', icon: 'play' },
};

export function isOverdue(task, now = today()) {
  return task.status !== 'completed' && Boolean(task.due_date) && task.due_date < now;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(
    'en-GB',
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
  );
}

export const DEFAULT_FILTERS = {
  search: '',
  status: 'all',
  priority: 'all',
  assignee: 'all',
  project: 'all',
  quick: 'all', // all | review | overdue
};

export function filterTasks(tasks, filters) {
  const text = (filters.search || '').trim().toLowerCase();
  return tasks.filter((task) => {
    if (text) {
      const haystack = `${task.title} ${task.description} ${displayName(task.assignee)} ${task.project ? task.project.name : ''}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    if (filters.status && filters.status !== 'all' && task.status !== filters.status) return false;
    if (filters.priority && filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (filters.assignee && filters.assignee !== 'all' && String(task.assignee.id) !== filters.assignee) return false;
    if (filters.project && filters.project !== 'all') {
      if (filters.project === 'none' ? task.project : String(task.project && task.project.id) !== filters.project) return false;
    }
    if (filters.quick === 'review' && task.status !== 'in_review') return false;
    if (filters.quick === 'overdue' && !isOverdue(task)) return false;
    return true;
  });
}

export function sortTasks(tasks, key) {
  const list = [...tasks];
  const byDue = (a, b) => (a.due_date || '').localeCompare(b.due_date || '');
  const byPriority = (a, b) => PRIORITY_RANK.indexOf(a.priority) - PRIORITY_RANK.indexOf(b.priority);
  // Finished work goes to the bottom, so open tasks stay at the top of the list.
  const finishedLast = (a, b) => Number(a.status === 'completed') - Number(b.status === 'completed');
  if (key === 'priority') return list.sort((a, b) => byPriority(a, b) || byDue(a, b));
  if (key === 'status') return list.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byDue(a, b));
  if (key === 'title') return list.sort((a, b) => a.title.localeCompare(b.title));
  return list.sort((a, b) => finishedLast(a, b) || byDue(a, b) || byPriority(a, b));
}

// ---------- Page helpers: messages, employee list, task actions ----------

// One place for the success / error message shown at the top of a page.
export function useBanner() {
  const [banner, setBanner] = useState({ message: '', isError: false });
  const timer = useRef(null);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setBanner({ message: '', isError: false });
  }, []);

  const show = useCallback((message, isError) => {
    clearTimeout(timer.current);
    setBanner({ message, isError });
    if (!isError) timer.current = setTimeout(() => setBanner({ message: '', isError: false }), 4500);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const success = useCallback((message) => show(message, false), [show]);
  const failure = useCallback(
    (error) => show((error && error.message) || 'Something went wrong. Please try again.', true),
    [show],
  );
  return { banner, success, failure, clear };
}
// Employees a manager can assign tasks to.
export function useEmployees(enabled = true) {
  const [employees, setEmployees] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    getJson('/api/accounts/employees/')
      .then((people) => {
        if (!cancelled) setEmployees(people.filter((person) => person.role === 'Employee'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return employees;
}

// The three things that can happen to a task. Every call throws on a server error,
// so the panel or form that triggered it can show the message in place.
export function useTaskActions({ reload, success }) {
  async function save(task, body) {
    if (task) {
      await sendJson(`/api/workspace/tasks/${task.id}/`, 'PATCH', body);
    } else {
      await sendJson('/api/workspace/tasks/', 'POST', body);
    }
    success(task ? 'Task updated.' : 'Task created.');
    await reload();
  }

  // Manager decision on a task that was submitted for review.
  async function review(task, decision, feedback) {
    const body = { status: decision };
    if (feedback && feedback.trim()) body.feedback = feedback.trim();
    await sendJson(`/api/workspace/tasks/${task.id}/`, 'PATCH', body);
    success(
      decision === 'completed'
        ? 'Task approved and marked as completed.'
        : 'Changes requested. The employee can see your feedback.',
    );
    await reload();
  }

  // Employee moves their own task one step forward.
  async function advance(task) {
    await sendJson(`/api/workspace/tasks/${task.id}/`, 'PATCH', { status: task.next_status });
    success(task.next_status === 'in_review' ? 'Submitted for review.' : 'Task moved to In Progress.');
    await reload();
  }

  return { save, review, advance };
}

// ---------- Small building blocks: icons, badges, panels, tabs ----------

// Small inline icon set (Lucide-style, 24x24 stroke icons), so no new package is needed.
const PATHS = {
  layout: (<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>),
  folder: (<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />),
  tasks: (<><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></>),
  search: (<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>),
  plus: (<><path d="M5 12h14" /><path d="M12 5v14" /></>),
  x: (<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>),
  logout: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>),
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>),
  check: (<path d="M20 6 9 17l-5-5" />),
  send: (<><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>),
  play: (<polygon points="6 3 20 12 6 21 6 3" />),
  message: (<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  edit: (<><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>),
  alert: (<><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>),
  chevron: (<path d="m9 18 6-6-6-6" />),
  clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
  flag: (<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22v-7" /></>),
  back: (<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>),
};

export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg
      className={`ws-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'B';
}

export function Avatar({ name, size = 24 }) {
  return (
    <span className="ws-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

// Status = where the work is. Shown as a filled pill with a dot.
export function StatusBadge({ status }) {
  return (
    <span className={`ws-status ws-status-${status}`}>
      <span className="ws-dot" />
      {labelOf(STATUSES, status)}
    </span>
  );
}

// Priority = how urgent the work is. Shown as a plain flag, so it never looks like a status.
export function PriorityBadge({ priority }) {
  return (
    <span className={`ws-priority ws-priority-${priority}`}>
      <Icon name="flag" size={13} />
      {labelOf(PRIORITIES, priority)}
    </span>
  );
}

export function ProgressBar({ progress, showText = true }) {
  const { percent = 0, completed_tasks: done = 0, total_tasks: total = 0 } = progress || {};
  return (
    <div className="ws-progress">
      <div className="ws-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="ws-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      {showText && <span className="ws-progress-text">{done}/{total} · {percent}%</span>}
    </div>
  );
}

export function EmptyState({ icon = 'tasks', title, children, action }) {
  return (
    <div className="ws-empty">
      <span className="ws-empty-icon"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }) {
  return (
    <div className="ws-card" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div className="ws-skeleton-row" key={index}>
          <span className="ws-skeleton" style={{ width: '34%' }} />
          <span className="ws-skeleton" style={{ width: '14%' }} />
          <span className="ws-skeleton" style={{ width: '10%' }} />
          <span className="ws-skeleton" style={{ width: '12%' }} />
        </div>
      ))}
    </div>
  );
}

function useOverlay(onClose) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
}

function Overlay({ title, onClose, children, className, centered }) {
  useOverlay(onClose);
  return (
    <div
      className={`ws-overlay${centered ? ' ws-overlay-centered' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={className} role="dialog" aria-modal="true" aria-label={title}>
        <header className="ws-panel-header">
          <h2 className="ws-panel-title">{title}</h2>
          <button type="button" className="ws-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="ws-panel-body">{children}</div>
      </div>
    </div>
  );
}

// Side panel for task details and the task form.
export function Drawer(props) {
  return <Overlay {...props} className="ws-drawer" />;
}

// Centered dialog for short forms (projects).
export function Modal(props) {
  return <Overlay {...props} className="ws-modal" centered />;
}

// Row of tabs with a count: tabs = [[key, label, count], ...]
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="ws-tabs" role="tablist">
      {tabs.map(([key, label, count]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          className={`ws-tab${active === key ? ' active' : ''}`}
          onClick={() => onChange(key)}
        >
          {label}
          {count !== undefined && <span className="ws-tab-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

// items = [{ label, value, tone }]; tone is '', 'warn' or 'danger'
export function Stats({ items }) {
  return (
    <div className="ws-stats">
      {items.map((item) => (
        <div className={`ws-stat${item.tone ? ` ws-stat-${item.tone}` : ''}`} key={item.label}>
          <span className="ws-stat-value">{item.value}</span>
          <span className="ws-stat-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`ws-switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ws-switch-knob" />
    </button>
  );
}

// ---------- Task list ----------

// The one task list used by every workspace page.
// `renderAction(task)` adds an optional button column (used on the employee page).
export function TaskTable({ tasks, onOpen, showProject = true, showAssignee = true, renderAction, selectedId }) {
  return (
    <div className="ws-card ws-table-card">
      <table className="ws-table">
        <thead>
          <tr>
            <th>Task</th>
            {showAssignee && <th>Assignee</th>}
            <th>Due</th>
            <th>Priority</th>
            <th>Status</th>
            {renderAction && <th aria-label="Action" />}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const overdue = isOverdue(task);
            return (
              <tr
                key={task.id}
                className={`ws-row${selectedId === task.id ? ' selected' : ''}`}
                tabIndex={0}
                onClick={() => onOpen(task)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(task);
                }}
              >
                <td>
                  <div className="ws-task-title">{task.title}</div>
                  {showProject && task.project && (
                    <div className="ws-task-sub"><Icon name="folder" size={12} />{task.project.name}</div>
                  )}
                </td>
                {showAssignee && (
                  <td>
                    <span className="ws-person"><Avatar name={displayName(task.assignee)} />{displayName(task.assignee)}</span>
                  </td>
                )}
                <td>
                  <span className={`ws-due${overdue ? ' ws-overdue' : ''}`}>
                    {overdue && <Icon name="clock" size={13} />}
                    {formatDate(task.due_date)}
                  </span>
                </td>
                <td><PriorityBadge priority={task.priority} /></td>
                <td><StatusBadge status={task.status} /></td>
                {renderAction && (
                  <td className="ws-cell-action" onClick={(event) => event.stopPropagation()}>
                    {renderAction(task)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Task form (create and edit) ----------

// Create or edit a task. A new task always starts as To Do, so there is no status field.
// `onSubmit(body)` must throw when the server refuses; the message is shown in the form.
export function TaskForm({ task, projects, employees, lockedProjectId, onSubmit, onCancel }) {
  const defaultProject = lockedProjectId
    ? String(lockedProjectId)
    : new URLSearchParams(window.location.search).get('project') || '';

  const [form, setForm] = useState(
    task
      ? {
          title: task.title,
          description: task.description,
          project: task.project ? String(task.project.id) : '',
          assignee: String(task.assignee.id),
          start_date: task.start_date,
          due_date: task.due_date,
          priority: task.priority,
          privacy: task.privacy || 'private',
        }
      : {
          title: '',
          description: '',
          project: defaultProject,
          assignee: '',
          start_date: today(),
          due_date: '',
          priority: 'medium',
          privacy: 'private',
        },
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  // Same rules as the backend, so problems show before anything is sent.
  function validate() {
    if (!form.title.trim()) return 'Task title is required.';
    if (!form.assignee) return 'Choose an employee to assign the task to.';
    if (!form.start_date) return 'Start date is required.';
    if (!form.due_date) return 'Due date is required.';
    if (form.due_date < form.start_date) return 'The due date cannot be before the start date.';
    return '';
  }

  async function submit(event) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSubmit({
        title: form.title.trim(),
        description: form.description,
        project: form.project ? Number(form.project) : null,
        assignee: Number(form.assignee),
        start_date: form.start_date,
        due_date: form.due_date,
        priority: form.priority,
        privacy: form.privacy,
      });
    } catch (failure) {
      setError(failure.message || 'The task could not be saved.');
      setSaving(false);
    }
  }

  return (
    <form className="ws-form" onSubmit={submit} noValidate>
      {error && <div className="ws-form-error" role="alert">{error}</div>}

      <label className="ws-field">
        <span className="ws-label">Title</span>
        <input className="ws-input" value={form.title} maxLength={255} autoFocus onChange={(event) => setField('title', event.target.value)} />
      </label>

      <label className="ws-field">
        <span className="ws-label">Description and instructions</span>
        <textarea className="ws-textarea" rows={4} value={form.description} onChange={(event) => setField('description', event.target.value)} />
      </label>

      <div className="ws-form-grid">
        <label className="ws-field">
          <span className="ws-label">Assignee</span>
          <select className="ws-select" value={form.assignee} onChange={(event) => setField('assignee', event.target.value)}>
            <option value="">Choose an employee</option>
            {employees.map((person) => (
              <option key={person.id} value={person.id}>{displayName(person)}</option>
            ))}
          </select>
        </label>
        <label className="ws-field">
          <span className="ws-label">Priority</span>
          <select className="ws-select" value={form.priority} onChange={(event) => setField('priority', event.target.value)}>
            {PRIORITIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <label className="ws-field">
          <span className="ws-label">Start date</span>
          <input className="ws-input" type="date" value={form.start_date} onChange={(event) => setField('start_date', event.target.value)} />
        </label>
        <label className="ws-field">
          <span className="ws-label">Due date</span>
          <input className="ws-input" type="date" value={form.due_date} onChange={(event) => setField('due_date', event.target.value)} />
        </label>
      </div>


      <label className="ws-field">
        <span className="ws-label">Task privacy</span>
        <select
          className="ws-select"
          value={form.privacy}
          onChange={(event) => setField('privacy', event.target.value)}
        >
          <option value="private">Private</option>
          <option value="public">Public</option>
        </select>
        <span className="ws-hint">
          Private tasks are visible to the assigned employee and manager.
          Public tasks can be visible to authorized project users.
        </span>
      </label>


      {!lockedProjectId && (
        <label className="ws-field">
          <span className="ws-label">Project <span className="ws-optional">(optional)</span></span>
          <select className="ws-select" value={form.project} onChange={(event) => setField('project', event.target.value)}>
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="ws-form-actions">
        <button className="ws-btn ws-btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}
        </button>
        <button className="ws-btn ws-btn-secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

// ---------- Project form (create and edit) ----------

// Create or edit a project. `onSubmit(body)` must throw when the server refuses.
export function ProjectForm({ project, onSubmit, onCancel }) {
  const [name, setName] = useState(project ? project.name : '');
  const [description, setDescription] = useState(project ? project.description : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Project name is required.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), description });
    } catch (failure) {
      setError(failure.message || 'The project could not be saved.');
      setSaving(false);
    }
  }

  return (
    <form className="ws-form" onSubmit={submit} noValidate>
      {error && <div className="ws-form-error" role="alert">{error}</div>}
      <label className="ws-field">
        <span className="ws-label">Project name</span>
        <input className="ws-input" value={name} maxLength={255} autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="ws-field">
        <span className="ws-label">Description <span className="ws-optional">(optional)</span></span>
        <textarea className="ws-textarea" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="ws-form-actions">
        <button className="ws-btn ws-btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : project ? 'Save changes' : 'Create project'}
        </button>
        <button className="ws-btn ws-btn-secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

// ---------- Task details panel (employee actions and manager review) ----------

const FEEDBACK_TITLES = {
  changes_requested: 'Changes requested',
  in_review: 'Previous feedback',
};

// Task details inside a side panel, plus the actions that belong to the viewer:
//  - employee: move the task forward / submit for review
//  - manager:  edit, approve, or request changes
// Handlers (onAdvance, onReview) must throw on a server error; it is shown here.
export function TaskPanel({ task, role, onEdit, onAdvance, onReview, projectHref }) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setFeedback('');
    setError('');
  }, [task.id, task.status]);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function requestChanges() {
    if (!feedback.trim()) {
      setError('Write feedback explaining the changes you need.');
      return;
    }
    run(() => onReview(task, 'changes_requested', feedback));
  }

  const employeeAction = EMPLOYEE_ACTIONS[task.status];
  const canAdvance = role === 'Employee' && task.is_mine && task.next_status && employeeAction;
  const overdue = isOverdue(task);

  return (
    <div className="ws-task-panel">
      <h3 className="ws-task-heading">{task.title}</h3>
      <div className="ws-badges">
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
      </div>

      {task.feedback && (
        <div className={`ws-feedback${task.status === 'changes_requested' ? ' ws-feedback-alert' : ''}`}>
          <div className="ws-feedback-title">
            <Icon name="message" size={15} />
            {FEEDBACK_TITLES[task.status] || 'Manager feedback'}
          </div>
          <p>{task.feedback}</p>
        </div>
      )}

      {error && <div className="ws-form-error" role="alert">{error}</div>}

      {canAdvance && (
        <div className="ws-panel-actions">
          <button type="button" className="ws-btn ws-btn-primary" disabled={busy} onClick={() => run(() => onAdvance(task))}>
            <Icon name={employeeAction.icon} size={15} />
            {employeeAction.label}
          </button>
          {task.status === 'in_progress' && <span className="ws-hint">Your manager will review it before it is completed.</span>}
        </div>
      )}
      {role === 'Employee' && task.is_mine && task.status === 'in_review' && (
        <p className="ws-hint">Waiting for your manager’s review.</p>
      )}

      <dl className="ws-detail-grid">
        <div>
          <dt>Assignee</dt>
          <dd><span className="ws-person"><Avatar name={displayName(task.assignee)} />{displayName(task.assignee)}</span></dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>
            {task.project
              ? (projectHref ? <a className="ws-link" href={projectHref(task.project)}>{task.project.name}</a> : task.project.name)
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Start date</dt>
          <dd>{formatDate(task.start_date)}</dd>
        </div>
        <div>
          <dt>Due date</dt>
          <dd className={overdue ? 'ws-overdue' : ''}>{formatDate(task.due_date)}{overdue ? ' · overdue' : ''}</dd>
        </div>
      </dl>

      <h4 className="ws-section-title">Description</h4>
      <p className="ws-description">{task.description || 'No description.'}</p>

      {role === 'Manager' && task.can_review && (
        <div className="ws-review-box">
          <h4 className="ws-section-title">Review this task</h4>
          <p className="ws-hint">The employee submitted this task. Approve it, or ask for changes.</p>
          <label className="ws-field">
            <span className="ws-label">Feedback <span className="ws-optional">(required to request changes)</span></span>
            <textarea className="ws-textarea" rows={3} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
          </label>
          <div className="ws-review-actions">
            <button type="button" className="ws-btn ws-btn-success" disabled={busy} onClick={() => run(() => onReview(task, 'completed', feedback))}>
              <Icon name="check" size={15} />
              Approve
            </button>
            <button type="button" className="ws-btn ws-btn-outline-danger" disabled={busy} onClick={requestChanges}>
              Request changes
            </button>
          </div>
        </div>
      )}

      {role === 'Manager' && onEdit && (
        <div className="ws-panel-footer">
          <button type="button" className="ws-btn ws-btn-secondary" onClick={onEdit}>
            <Icon name="edit" size={15} />
            Edit task
          </button>
        </div>
      )}
    </div>
  );
}