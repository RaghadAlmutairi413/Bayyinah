import { useEffect, useState } from 'react';
import { displayName } from './api.js';
import Shell, { Banner, HeaderActions } from './Shell.jsx';
import {
  DEFAULT_FILTERS,
  Drawer,
  EmptyState,
  Icon,
  PRIORITIES,
  STATUSES,
  TableSkeleton,
  TaskForm,
  TaskPanel,
  TaskTable,
  filterTasks,
  getJson,
  isOverdue,
  sortTasks,
  useBanner,
  useEmployees,
  useTaskActions,
} from './taskUi.jsx';

const SORTS = [['due', 'Due date'], ['priority', 'Priority'], ['status', 'Status'], ['title', 'Title']];

function TasksContent() {
  const { banner, success, failure, clear } = useBanner();
  const employees = useEmployees();
  const [tasks, setTasks] = useState(null); // null while loading
  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState('due');
  const [panel, setPanel] = useState(null); // { type: 'view', id } | { type: 'form', task }

  async function loadTasks() {
    try {
      setTasks(await getJson('/api/workspace/tasks/'));
    } catch (error) {
      failure(error);
      setTasks((current) => current || []);
    }
  }

  useEffect(() => {
    loadTasks();
    getJson('/api/workspace/projects/').then(setProjects).catch(failure);
    // Links from other pages: ?project=ID opens the new-task form, ?task=ID opens that task.
    const params = new URLSearchParams(window.location.search);
    if (params.get('project')) setPanel({ type: 'form', task: null });
    else if (params.get('task')) setPanel({ type: 'view', id: Number(params.get('task')) });
  }, []);

  const actions = useTaskActions({ reload: loadTasks, success });

  function setFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  const all = tasks || [];
  const reviewCount = all.filter((task) => task.status === 'in_review').length;
  const overdueCount = all.filter((task) => isOverdue(task)).length;
  const shown = sortTasks(filterTasks(all, filters), sort);
  const filtering = filters.search || filters.status !== 'all' || filters.priority !== 'all'
    || filters.assignee !== 'all' || filters.project !== 'all' || filters.quick !== 'all';
  const selected = panel && panel.type === 'view' ? all.find((task) => task.id === panel.id) : null;

  async function saveTask(body) {
    await actions.save(panel.task, body);
    setPanel(panel.task ? { type: 'view', id: panel.task.id } : null);
  }

  const chips = [
    ['all', 'All', all.length],
    ['review', 'Awaiting review', reviewCount],
    ['overdue', 'Overdue', overdueCount],
  ];

  return (
    <>
      <HeaderActions>
        <button className="ws-btn ws-btn-primary" type="button" onClick={() => setPanel({ type: 'form', task: null })}>
          <Icon name="plus" size={15} />
          New task
        </button>
      </HeaderActions>

      <Banner message={banner.message} isError={banner.isError} onClose={clear} />

      <div className="ws-chips">
        {chips.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className={`ws-chip${filters.quick === key ? ' active' : ''}${key === 'review' && count > 0 ? ' attention' : ''}`}
            onClick={() => setFilter('quick', key)}
          >
            {label}<span className="ws-tab-count">{count}</span>
          </button>
        ))}
      </div>

      <div className="ws-toolbar">
        <label className="ws-search">
          <Icon name="search" size={15} />
          <input type="search" placeholder="Search tasks" value={filters.search} onChange={(event) => setFilter('search', event.target.value)} aria-label="Search tasks" />
        </label>
        <select className="ws-select ws-select-sm" value={filters.status} onChange={(event) => setFilter('status', event.target.value)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {STATUSES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        <select className="ws-select ws-select-sm" value={filters.priority} onChange={(event) => setFilter('priority', event.target.value)} aria-label="Filter by priority">
          <option value="all">All priorities</option>
          {PRIORITIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        <select className="ws-select ws-select-sm" value={filters.assignee} onChange={(event) => setFilter('assignee', event.target.value)} aria-label="Filter by assignee">
          <option value="all">All assignees</option>
          {employees.map((person) => <option key={person.id} value={person.id}>{displayName(person)}</option>)}
        </select>
        <select className="ws-select ws-select-sm" value={filters.project} onChange={(event) => setFilter('project', event.target.value)} aria-label="Filter by project">
          <option value="all">All projects</option>
          <option value="none">No project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <span className="ws-spacer" />
        <label className="ws-sort">
          Sort by
          <select className="ws-select ws-select-sm" value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORTS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
      </div>

      {tasks === null ? (
        <TableSkeleton />
      ) : all.length === 0 ? (
        <div className="ws-card">
          <EmptyState
            title="No tasks yet"
            action={<button className="ws-btn ws-btn-primary" type="button" onClick={() => setPanel({ type: 'form', task: null })}>Create your first task</button>}
          >
            Tasks you create and assign to your team will appear here.
          </EmptyState>
        </div>
      ) : shown.length === 0 ? (
        <div className="ws-card">
          <EmptyState icon="search" title="No tasks match these filters" action={filtering ? <button className="ws-btn ws-btn-secondary" type="button" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button> : null} />
        </div>
      ) : (
        <TaskTable tasks={shown} selectedId={selected ? selected.id : null} onOpen={(task) => setPanel({ type: 'view', id: task.id })} />
      )}

      {selected && (
        <Drawer title="Task details" onClose={() => setPanel(null)}>
          <TaskPanel
            task={selected}
            role="Manager"
            projectHref={(project) => `/manager/project?id=${project.id}`}
            onEdit={() => setPanel({ type: 'form', task: selected })}
            onReview={actions.review}
          />
        </Drawer>
      )}

      {panel && panel.type === 'form' && (
        <Drawer title={panel.task ? 'Edit task' : 'New task'} onClose={() => setPanel(panel.task ? { type: 'view', id: panel.task.id } : null)}>
          <TaskForm
            task={panel.task}
            projects={projects}
            employees={employees}
            onSubmit={saveTask}
            onCancel={() => setPanel(panel.task ? { type: 'view', id: panel.task.id } : null)}
          />
        </Drawer>
      )}
    </>
  );
}

export default function ManagerTasks() {
  return (
    <Shell role="Manager" title="Tasks">
      <TasksContent />
    </Shell>
  );
}