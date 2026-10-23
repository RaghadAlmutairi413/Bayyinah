import { useEffect, useState } from 'react';
import { apiRequest, clearLogin, displayName, getLogin, responseData } from './api.js';

import Shell, { Banner } from './Shell.jsx';
import {
  EmptyState,
  ProgressBar,
  Stats,
  StatusBadge,
  TableSkeleton,
  formatDate,
  getJson,
  isOverdue,
  sortTasks,
  useBanner,
} from './taskUi.jsx';

const BATCH_KEY = 'bayyinahCsvImportV2';

function dashboardPath(role) {
  if (role === 'HR' || role === 'HR Professional') return '/dashboard/hr';
  if (role === 'Manager') return '/dashboard/manager';
  return '/dashboard/employee';
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'B';
}

export default function Dashboard({ role }) {
  const [login, setLogin] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [batch, setBatch] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(BATCH_KEY) || 'null');
    } catch {
      return null;
    }
  });
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const savedLogin = getLogin();
    if (!savedLogin) {
      window.location.replace('/login');
      return;
    }


    const actualRole = savedLogin.user.role === 'HR Professional' ? 'HR' : savedLogin.user.role;
    if (actualRole !== role) {
      window.location.replace(dashboardPath(actualRole));
      return;
    }

    setLogin(savedLogin);
    loadEmployees();
  }, [role]);

  async function loadEmployees() {
    try {
      const response = await apiRequest('/api/accounts/employees/');
      setEmployees(await responseData(response));
    } catch (error) {
      setIsError(true);
      setMessage(error.message || 'Employee information could not be loaded.');
    }
  }

  async function importCsv(event) {
    event.preventDefault();
    if (!selectedFile) {
      setIsError(true);
      setMessage('Choose a CSV file before importing.');
      return;
    }

    setIsBusy(true);
    setMessage('');
    setIsError(false);
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      const response = await apiRequest('/api/accounts/import-csv/', {
        method: 'POST',
        body: form,
      });
      const result = await responseData(response);
      setBatch(result);
      sessionStorage.setItem(BATCH_KEY, JSON.stringify(result));
      setSelectedFile(null);
      event.target.reset();
      setMessage(result.status);
      setIsError(result.errors.length > 0);
      await loadEmployees();
    } catch (error) {
      setIsError(true);
      setMessage(error.message || 'The CSV could not be imported.');
    } finally {
      setIsBusy(false);
    }
  }

  async function inviteAll() {
    if (!batch?.pending_invitation_ids?.length) return;
    setIsBusy(true);
    setMessage('');
    setIsError(false);
    try {
      const response = await apiRequest(
        '/api/accounts/import-csv/invite-all/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employee_ids: batch.pending_invitation_ids }),
        },
      );
      const result = await responseData(response);
      const updatedBatch = {
        ...batch,
        invitations: result,
        pending_invitation_ids: result.remaining_ids,
      };
      setBatch(updatedBatch);
      sessionStorage.setItem(BATCH_KEY, JSON.stringify(updatedBatch));
      setMessage(result.message);
      setIsError(result.errors.length > 0);
      if (result.remaining === 0) {
        window.history.replaceState(null, '', '/dashboard/hr?invitations=sent');
      }
    } catch (error) {
      setIsError(true);
      setMessage(error.message || 'Invitations could not be sent.');
    } finally {
      setIsBusy(false);
    }
  }

  function logout() {
    clearLogin();
    sessionStorage.removeItem(BATCH_KEY);
    window.location.assign('/');
  }

  if (!login) {
    return <main className="page"><section className="card">Opening your workspace…</section></main>;
  }

  const departmentNames = [...new Set(employees.map((employee) => employee.department.name))];
  const managerCount = employees.filter((employee) => employee.role === 'Manager').length;
  const employeeCount = employees.filter((employee) => employee.role === 'Employee').length;
  const hrCount = employees.filter((employee) => employee.role === 'HR').length;
  const invitationsPending = batch?.invitations?.remaining ?? batch?.summary?.total_added ?? 0;

  return (
    <Shell role={role} title={role === 'HR' ? 'HR Dashboard' : `${role} Dashboard`} subtitle={`Welcome back, ${displayName(login.user)}`}>
      <div className="dashboard dashboard-in-shell">
      {message && (
        <div className={`status-banner${isError ? ' error' : ''}`} role="status">
          <span aria-hidden="true">{isError ? '!' : '✓'}</span>
          <span>{message}</span>
        </div>
      )}

      <div className="dashboard-workspace">
        <div className="dashboard-content">
        <div className="dashboard-main">
          {role === 'HR' && (
            <>
              <section className="dashboard-panel" id="import">
                <div className="dashboard-toolbar">
                  <div>
                    <h2>Bring your team into Bayyinah</h2>
                    <p className="description">
                      Import your employee list. Review the department summary, then send
                      secure invitations when everything looks right.
                    </p>
                  </div>
                  <a className="button button-primary" href="#upload">Import team</a>
                </div>
                <form className="upload-form" id="upload" onSubmit={importCsv}>
                  <label htmlFor="employee-csv">Choose an employee CSV file</label>
                  <input
                    id="employee-csv"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                    disabled={isBusy}
                    required
                  />
                  <button className="button button-primary" type="submit" disabled={isBusy || !selectedFile}>
                    {isBusy ? 'Importing…' : 'Upload and review'}
                  </button>
                </form>

                {batch && (
                  <div className="import-summary">
                    <div className="summary-title">
                      <h3>Import summary</h3>
                      <span className="summary-state">
                        {batch.invitations?.remaining === 0 ? 'Invitations sent' : 'Ready to invite'}
                      </span>
                    </div>
                    <p className="description">{batch.status}</p>
                    <div className="summary-grid">
                      <div><strong>{batch.summary.employees_added}</strong><span>Employees added</span></div>
                      <div><strong>{batch.summary.managers_added}</strong><span>Managers added</span></div>
                      <div><strong>{batch.summary.hr_added || 0}</strong><span>HR added</span></div>
                      <div><strong>{batch.summary.departments.length}</strong><span>Departments</span></div>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr><th>Department</th><th>Employees</th><th>Managers</th><th>HR</th></tr>
                        </thead>
                        <tbody>
                          {batch.summary.departments.map((department) => (
                            <tr key={department.name}>
                              <td>{department.name}</td>
                              <td>{department.employees}</td>
                              <td>{department.managers}</td>
                              <td>{department.hr || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {batch.errors.length > 0 && (
                      <div className="summary-errors">
                        <strong>Some rows need review</strong>
                        <ul>
                          {batch.errors.map((error) => (
                            <li key={`${error.row}-${String(error.detail)}`}>
                              Row {error.row}: {Array.isArray(error.detail) ? error.detail.join(' ') : error.detail}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="import-actions">
                      <p>
                        {batch.invitations
                          ? `${batch.invitations.invited} invited · ${batch.invitations.remaining} remaining`
                          : 'Accounts are saved without passwords. Invitations have not been sent yet.'}
                      </p>
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={inviteAll}
                        disabled={isBusy || batch.summary.total_added === 0 || batch.invitations?.remaining === 0}
                      >
                        {isBusy ? 'Sending invitations…' : batch.invitations?.remaining === 0 ? 'Invitations sent' : 'Invite all'}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section className="dashboard-panel" id="team">
                <div className="dashboard-toolbar">
                  <div>
                    <h2>People in your organization</h2>
                    <p className="description">Employee information is scoped to your organization.</p>
                  </div>
                </div>
                <EmployeeTable employees={employees} />
              </section>
            </>
          )}

          {role === 'Manager' && (
            <section className="dashboard-panel" id="team">
              <h2>Your department team</h2>
              <p className="description">People information available to your Manager role.</p>
              <EmployeeTable employees={employees} />
            </section>
          )}

          {role === 'Employee' && (
            <section className="dashboard-panel" id="team">
              <h2>Your employee profile</h2>
              <p className="description">Your account details and department.</p>
              <EmployeeTable employees={employees} />
            </section>
          )}
        </div>

        <aside className="dashboard-aside">
          <section className="dashboard-panel" id={role === 'HR' ? 'overview' : undefined}>
            <h2>{role === 'HR' ? 'Team at a glance' : 'Your access'}</h2>
            {role === 'HR' ? (
              <>
                <div className="aside-stat"><span>Employees</span><strong>{employeeCount}</strong></div>
                <div className="aside-stat"><span>Managers</span><strong>{managerCount}</strong></div>
                <div className="aside-stat"><span>HR</span><strong>{hrCount}</strong></div>
                <div className="aside-stat"><span>Departments</span><strong>{departmentNames.length}</strong></div>
                <div className="aside-stat"><span>Awaiting invite</span><strong>{invitationsPending}</strong></div>
              </>
            ) : (
              <>
                <div className="aside-stat"><span>Signed in as</span><strong>{role}</strong></div>
                <div className="aside-stat"><span>Visible records</span><strong>{employees.length}</strong></div>
                <div className="aside-stat"><span>Department</span><strong>{employees[0]?.department.name || '—'}</strong></div>
              </>
            )}
          </section>
          <section className="info-card">
            <h3>{role === 'HR' ? 'A thoughtful start' : 'Your workspace, at a glance'}</h3>
            <p>
              {role === 'HR'
                ? 'Review every imported record before inviting your team. Each person sets their own password from a private invitation link.'
                : role === 'Manager'
                  ? 'Your team list is limited to employees in your department. HR manages organization-wide employee changes.'
                  : 'Your account only has access to your own employee profile.'}
            </p>
            {role === 'HR' && <a className="button" href="#import">Import your team</a>}
          </section>
        </aside>
      </div>
      </div>
      </div>
    </Shell>
  );
}

function EmployeeTable({ employees }) {
  if (!employees.length) {
    return <div className="empty-state">No employee records are available for this account yet.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th></tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            <tr key={employee.id}>
              <td>{displayName(employee)}</td>
              <td>{employee.email}</td>
              <td><span className={`table-role${employee.role === 'Manager' ? ' manager' : ''}`}>{employee.role}</span></td>
              <td>{employee.department.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// ---------- Manager and employee overview ----------

const ACTIONABLE = ['todo', 'in_progress', 'changes_requested'];

// A short list of tasks. Each row links to the page where the task can be opened.
function TaskList({ tasks, href, empty }) {
  if (tasks.length === 0) return <p className="ws-hint ws-list-empty">{empty}</p>;
  return (
    <ul className="ws-mini-list">
      {tasks.map((task) => (
        <li key={task.id}>
          <a className="ws-plain-link" href={href(task)}>
            <span className="ws-mini-title">{task.title}</span>
            <span className="ws-mini-meta">{displayName(task.assignee)} · {isOverdue(task) ? 'overdue since ' : 'due '}{formatDate(task.due_date)}</span>
          </a>
          <StatusBadge status={task.status} />
        </li>
      ))}
    </ul>
  );
}

function PeopleTable({ people }) {
  if (people.length === 0) {
    return <EmptyState icon="users" title="No employee records are available for this account yet" />;
  }
  return (
    <div className="ws-table-card">
      <table className="ws-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th></tr></thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id}>
              <td className="ws-task-title">{displayName(person)}</td>
              <td>{person.email}</td>
              <td>{person.role}</td>
              <td>{person.department.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverviewContent({ role }) {
  const isManager = role === 'Manager';
  const { banner, failure, clear } = useBanner();
  const [data, setData] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [tasks, projects, people] = await Promise.all([
          getJson('/api/workspace/tasks/'),
          getJson('/api/workspace/projects/'),
          getJson('/api/accounts/employees/'),
        ]);
        setData({ tasks, projects, people });
      } catch (error) {
        failure(error);
        setData({ tasks: [], projects: [], people: [] });
      }
    }
    load();
  }, []);

  if (!data) return <TableSkeleton rows={4} />;

  const { tasks, projects, people } = data;

  if (isManager) {
    const open = tasks.filter((task) => task.status !== 'completed');
    const review = sortTasks(tasks.filter((task) => task.status === 'in_review'), 'due');
    const overdue = sortTasks(tasks.filter((task) => isOverdue(task)), 'due');
    const taskHref = (task) => `/manager/tasks?task=${task.id}`;
    return (
      <>
        <Banner message={banner.message} isError={banner.isError} onClose={clear} />
        <Stats items={[
          { label: 'Projects', value: projects.length },
          { label: 'Open tasks', value: open.length },
          { label: 'Awaiting review', value: review.length, tone: review.length ? 'warn' : '' },
          { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'danger' : '' },
        ]}
        />
        <div className="ws-two-col">
          <section className="ws-card ws-side-card">
            <div className="ws-card-head"><h3>Awaiting your review</h3><a className="ws-link" href="/manager/tasks">All tasks</a></div>
            <TaskList tasks={review.slice(0, 5)} href={taskHref} empty="Nothing is waiting for your review." />
          </section>
          <section className="ws-card ws-side-card">
            <div className="ws-card-head"><h3>Overdue</h3><a className="ws-link" href="/manager/tasks">All tasks</a></div>
            <TaskList tasks={overdue.slice(0, 5)} href={taskHref} empty="No overdue tasks." />
          </section>
        </div>
        <section className="ws-card ws-side-card">
          <div className="ws-card-head"><h3>Your projects</h3><a className="ws-link" href="/manager/projects">All projects</a></div>
          {projects.length === 0 ? (
            <p className="ws-hint ws-list-empty">You have not created any projects yet.</p>
          ) : (
            <ul className="ws-member-list">
              {projects.slice(0, 5).map((project) => (
                <li key={project.id} className="ws-member-row">
                  <a className="ws-plain-link ws-task-title" href={`/manager/project?id=${project.id}`}>{project.name}</a>
                  <ProgressBar progress={project.progress} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ws-card ws-side-card">
          <div className="ws-card-head"><h3>Your department team</h3></div>
          <PeopleTable people={people} />
        </section>
      </>
    );
  }


  const mine = tasks.filter((task) => task.is_mine);
  const actionable = mine.filter((task) => ACTIONABLE.includes(task.status));
  const changes = mine.filter((task) => task.status === 'changes_requested');
  const overdue = actionable.filter((task) => isOverdue(task));
  const attention = sortTasks(
    actionable.filter((task) => task.status === 'changes_requested' || isOverdue(task)),
    'due',
  );
  return (
    <>
      <Banner message={banner.message} isError={banner.isError} onClose={clear} />
      <Stats items={[
        { label: 'Open tasks', value: actionable.length },
        { label: 'Changes requested', value: changes.length, tone: changes.length ? 'danger' : '' },
        { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'danger' : '' },
        { label: 'Submitted', value: mine.filter((task) => task.status === 'in_review').length },
        { label: 'Completed', value: mine.filter((task) => task.status === 'completed').length },
      ]}
      />
      <section className="ws-card ws-side-card">
        <div className="ws-card-head"><h3>Needs your attention</h3><a className="ws-link" href="/employee/tasks">My tasks</a></div>
        <TaskList tasks={attention.slice(0, 6)} href={(task) => `/employee/tasks?task=${task.id}`} empty="You are all caught up." />
      </section>
      <section className="ws-card ws-side-card">
        <div className="ws-card-head"><h3>Your employee profile</h3></div>
        <PeopleTable people={people} />
      </section>
    </>
  );
}

function WorkspaceOverview({ role }) {
  return (
    <Shell role={role} title="Overview">
      <OverviewContent role={role} />
    </Shell>
  );
}

export function DashboardRouter({ role }) {
  if (role === 'HR' || role === 'HR Professional') {
    return <Dashboard role="HR" />;
  }

  return <WorkspaceOverview role={role} />;
}
