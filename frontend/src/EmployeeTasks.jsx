import { useEffect, useState } from 'react';
import Shell, { Banner } from './Shell.jsx';
import {
  DEFAULT_FILTERS,
  Drawer,
  EMPLOYEE_ACTIONS,
  EmptyState,
  Icon,
  PRIORITIES,
  ProgressBar,
  TableSkeleton,
  Tabs,
  TaskPanel,
  TaskTable,
  filterTasks,
  getJson,
  isOverdue,
  sortTasks,
  today,
  useBanner,
  useTaskActions,
} from './taskUi.jsx';

// Tasks the employee can still act on.
const ACTIONABLE = ['todo', 'in_progress', 'changes_requested'];

function TasksContent() {
  const { banner, success, failure, clear } = useBanner();
  const [tasks, setTasks] = useState(null); // null while loading
  const [projects, setProjects] = useState([]);
  const [tab, setTab] = useState('open');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState('due');
  const [selectedId, setSelectedId] = useState(null);

  async function loadTasks() {
    try {
      setTasks(await getJson('/api/workspace/tasks/'));
      setProjects(await getJson('/api/workspace/projects/'));
    } catch (error) {
      failure(error);
      setTasks((current) => current || []);
    }
  }

  useEffect(() => {
    loadTasks();
    const wanted = new URLSearchParams(window.location.search).get('task');
    if (wanted) setSelectedId(Number(wanted));
  }, []);

  const actions = useTaskActions({ reload: loadTasks, success });

  async function advanceFromRow(task) {
    try {
      await actions.advance(task);
    } catch (error) {
      failure(error);
    }
  }

  const now = today();
  const all = tasks || [];
  const mine = all.filter((task) => task.is_mine);
  const actionable = mine.filter((task) => ACTIONABLE.includes(task.status));
  const lists = {
    open: actionable,
    today: actionable.filter((task) => task.due_date === now),
    upcoming: actionable.filter((task) => task.due_date > now),
    overdue: actionable.filter((task) => isOverdue(task, now)),
    review: mine.filter((task) => task.status === 'in_review'),
    completed: mine.filter((task) => task.status === 'completed'),
    project: all.filter((task) => !task.is_mine),
  };
  const tabs = [
    ['open', 'Open'], ['today', 'Due today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'],
    ['review', 'Submitted'], ['completed', 'Completed'], ['project', 'Project tasks'],
  ].map(([key, label]) => [key, label, lists[key].length]);

  const shown = sortTasks(filterTasks(lists[tab], filters), sort);
  const selected = all.find((task) => task.id === selectedId);
  const needChanges = mine.filter((task) => task.status === 'changes_requested');

  function showChanges() {
    setTab('open');
    setSelectedId(needChanges[0].id);
  }

  return (
    <>
      <Banner message={banner.message} isError={banner.isError} onClose={clear} />

      {needChanges.length > 0 && (
        <div className="ws-callout">
          <Icon name="message" size={18} />
          <div>
            <strong>{needChanges.length === 1 ? '1 task needs changes' : `${needChanges.length} tasks need changes`}</strong>
            <span>Your manager left feedback. Read it, update the work, then submit it again.</span>
          </div>
          <button className="ws-btn ws-btn-secondary ws-btn-sm" type="button" onClick={showChanges}>View feedback</button>
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="ws-toolbar">
        <label className="ws-search">
          <Icon name="search" size={15} />
          <input type="search" placeholder="Search tasks" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} aria-label="Search tasks" />
        </label>
        <select className="ws-select ws-select-sm" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })} aria-label="Filter by priority">
          <option value="all">All priorities</option>
          {PRIORITIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        <span className="ws-spacer" />
        <label className="ws-sort">
          Sort by
          <select className="ws-select ws-select-sm" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="status">Status</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>

      {tasks === null ? (
        <TableSkeleton />
      ) : shown.length === 0 ? (
        <div className="ws-card">
          <EmptyState icon={tab === 'completed' ? 'check' : 'tasks'} title={filters.search || filters.priority !== 'all' ? 'No tasks match these filters' : 'Nothing here'}>
            {tab === 'open' ? 'You have no open tasks right now.' : 'Tasks will show up in this tab when they apply.'}
          </EmptyState>
        </div>
      ) : (
        <TaskTable
          tasks={shown}
          showAssignee={tab === 'project'}
          selectedId={selectedId}
          onOpen={(task) => setSelectedId(task.id)}
          renderAction={(task) => {
            const action = EMPLOYEE_ACTIONS[task.status];
            if (!task.is_mine || !task.next_status || !action) return null;
            return (
              <button className="ws-btn ws-btn-secondary ws-btn-sm" type="button" onClick={() => advanceFromRow(task)}>
                <Icon name={action.icon} size={13} />
                {action.label}
              </button>
            );
          }}
        />
      )}

      {projects.length > 0 && (
        <section className="ws-card ws-side-card">
          <div className="ws-card-head"><h3>Projects you can view</h3></div>
          <ul className="ws-member-list">
            {projects.map((project) => (
              <li key={project.id} className="ws-member-row">
                <a className="ws-plain-link ws-task-title" href={`/employee/project?id=${project.id}`}>{project.name}</a>
                <ProgressBar progress={project.progress} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && (
        <Drawer title="Task details" onClose={() => setSelectedId(null)}>
          <TaskPanel
            task={selected}
            role="Employee"
            projectHref={(project) => `/employee/project?id=${project.id}`}
            onAdvance={actions.advance}
          />
        </Drawer>
      )}
    </>
  );
}

export default function EmployeeTasks() {
  return (
    <Shell role="Employee" title="My tasks">
      <TasksContent />
    </Shell>
  );
}