import { useEffect, useState } from 'react';
import { displayName } from './api.js';
import Shell, { Banner, HeaderActions } from './Shell.jsx';
import {
  Drawer,
  EmptyState,
  Icon,
  Modal,
  ProgressBar,
  ProjectForm,
  Stats,
  TableSkeleton,
  TaskForm,
  TaskPanel,
  TaskTable,
  formatDate,
  getJson,
  isOverdue,
  sendJson,
  useBanner,
  useEmployees,
  useTaskActions,
} from './taskUi.jsx';

function DetailsContent({ role }) {
  const projectId = new URLSearchParams(window.location.search).get('id');
  const isManager = role === 'Manager';
  const { banner, success, failure, clear } = useBanner();
  const employees = useEmployees(isManager);

  const [project, setProject] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [panel, setPanel] = useState(null);
  const [editing, setEditing] = useState(false);

  async function loadProject() {
    try {
      setProject(await getJson(`/api/workspace/projects/${projectId}/`));
      setLoadError('');
    } catch (error) {
      if (project === null) setLoadError(error.message);
      else failure(error);
    }
  }

  useEffect(() => {
    loadProject();
  }, []);

  const actions = useTaskActions({ reload: loadProject, success });

  async function saveProject(body) {
    await sendJson(`/api/workspace/projects/${projectId}/`, 'PATCH', body);
    setEditing(false);
    success('Project updated.');
    loadProject();
  }

  const backPath = isManager ? '/manager/projects' : '/employee/tasks';

  if (loadError) {
    return (
      <div className="ws-card">
        <EmptyState
          icon="alert"
          title="This project could not be opened"
          action={
            <a className="ws-btn ws-btn-secondary" href={backPath}>
              Back
            </a>
          }
        >
          {loadError}
        </EmptyState>
      </div>
    );
  }

  if (!project) return <TableSkeleton rows={4} />;

  const tasks = project.tasks || [];
  const selected =
    panel && panel.type === 'view'
      ? tasks.find((task) => task.id === panel.id)
      : null;

  const reviewCount = tasks.filter(
    (task) => task.status === 'in_review'
  ).length;

  const overdueCount = tasks.filter((task) => isOverdue(task)).length;

  const taskStats = [
    { label: 'Tasks', value: tasks.length },
    {
      label: 'Completed',
      value: tasks.filter((task) => task.status === 'completed').length,
    },
    {
      label: 'Awaiting review',
      value: reviewCount,
      tone: reviewCount ? 'warn' : '',
    },
    {
      label: 'Overdue',
      value: overdueCount,
      tone: overdueCount ? 'danger' : '',
    },
  ];

  const projectHref = (item) =>
    `${isManager ? '/manager' : '/employee'}/project?id=${item.id}`;

  return (
    <>
      {isManager && (
        <HeaderActions>
          <button
            className="ws-btn ws-btn-secondary"
            type="button"
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" size={15} />
            Edit project
          </button>

          <button
            className="ws-btn ws-btn-primary"
            type="button"
            onClick={() => setPanel({ type: 'form', task: null })}
          >
            <Icon name="plus" size={15} />
            Add task
          </button>
        </HeaderActions>
      )}

      <Banner
        message={banner.message}
        isError={banner.isError}
        onClose={clear}
      />

      <section className="ws-card ws-project-head">
        <div>
          <h2>{project.name}</h2>
          <p className="ws-project-desc">
            {project.description || 'No description yet.'}
          </p>
          <p className="ws-meta">
            Managed by {displayName(project.manager)}
          </p>
        </div>
        <ProgressBar progress={project.progress} />
      </section>

      <Stats items={taskStats} />

      {tasks.length === 0 ? (
        <div className="ws-card">
          <EmptyState
            title="This project has no tasks yet"
            action={
              isManager ? (
                <button
                  className="ws-btn ws-btn-primary"
                  type="button"
                  onClick={() => setPanel({ type: 'form', task: null })}
                >
                  Add the first task
                </button>
              ) : null
            }
          >
            Tasks added to this project will appear here.
          </EmptyState>
        </div>
      ) : (
        <TaskTable
          tasks={tasks}
          showProject={false}
          selectedId={selected ? selected.id : null}
          onOpen={(task) => setPanel({ type: 'view', id: task.id })}
        />
      )}

      {selected && (
        <Drawer title="Task details" onClose={() => setPanel(null)}>
          <TaskPanel
            task={selected}
            role={role}
            projectHref={projectHref}
            onEdit={
              isManager
                ? () => setPanel({ type: 'form', task: selected })
                : undefined
            }
            onReview={actions.review}
            onAdvance={actions.advance}
          />
        </Drawer>
      )}

      {isManager && panel && panel.type === 'form' && (
        <Drawer
          title={panel.task ? 'Edit task' : 'Add task'}
          onClose={() =>
            setPanel(
              panel.task ? { type: 'view', id: panel.task.id } : null
            )
          }
        >
          <TaskForm
            task={panel.task}
            projects={[{ id: project.id, name: project.name }]}
            lockedProjectId={project.id}
            employees={employees}
            onSubmit={async (body) => {
              await actions.save(panel.task, body);
              setPanel(
                panel.task ? { type: 'view', id: panel.task.id } : null
              );
            }}
            onCancel={() =>
              setPanel(
                panel.task ? { type: 'view', id: panel.task.id } : null
              )
            }
          />
        </Drawer>
      )}

      {editing && (
        <Modal title="Edit project" onClose={() => setEditing(false)}>
          <ProjectForm
            project={project}
            onSubmit={saveProject}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      )}
    </>
  );
}

export default function ProjectDetails({ role }) {
  const crumbs =
    role === 'Manager'
      ? [['Projects', '/manager/projects'], ['Project details']]
      : [['My tasks', '/employee/tasks'], ['Project details']];

  return (
    <Shell role={role} title="Project details" breadcrumbs={crumbs}>
      <DetailsContent role={role} />
    </Shell>
  );
}
