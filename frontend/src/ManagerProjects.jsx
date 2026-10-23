import { useEffect, useState } from 'react';
import Shell, { Banner, HeaderActions } from './Shell.jsx';
import {
  EmptyState,
  Icon,
  Modal,
  ProgressBar,
  ProjectForm,
  TableSkeleton,
  formatDate,
  getJson,
  sendJson,
  useBanner,
} from './taskUi.jsx';

function ProjectsContent() {
  const { banner, success, failure, clear } = useBanner();
  const [projects, setProjects] = useState(null); // null while loading
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  async function loadProjects() {
    try {
      setProjects(await getJson('/api/workspace/projects/'));
    } catch (error) {
      failure(error);
      setProjects((current) => current || []);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function createProject(body) {
    await sendJson('/api/workspace/projects/', 'POST', body);
    setCreating(false);
    success('Project created.');
    loadProjects();
  }

  function open(project) {
    window.location.assign(`/manager/project?id=${project.id}`);
  }

  const text = search.trim().toLowerCase();
  const shown = (projects || []).filter(
    (project) => !text || `${project.name} ${project.description}`.toLowerCase().includes(text),
  );

  return (
    <>
      <HeaderActions>
        <button className="ws-btn ws-btn-primary" type="button" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} />
          New project
        </button>
      </HeaderActions>

      <Banner message={banner.message} isError={banner.isError} onClose={clear} />

      <div className="ws-toolbar">
        <label className="ws-search">
          <Icon name="search" size={15} />
          <input type="search" placeholder="Search projects" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search projects" />
        </label>
      </div>

      {projects === null ? (
        <TableSkeleton />
      ) : projects.length === 0 ? (
        <div className="ws-card">
          <EmptyState
            icon="folder"
            title="No projects yet"
            action={<button className="ws-btn ws-btn-primary" type="button" onClick={() => setCreating(true)}>Create your first project</button>}
          >
            Projects group related tasks and show how far your team has got.
          </EmptyState>
        </div>
      ) : shown.length === 0 ? (
        <div className="ws-card"><EmptyState icon="search" title="No projects match your search" /></div>
      ) : (
        <div className="ws-card ws-table-card">
          <table className="ws-table">
            <thead>
              <tr><th>Project</th><th>Progress</th><th>Created</th><th aria-label="Open" /></tr>
            </thead>
            <tbody>
              {shown.map((project) => (
                <tr
                  key={project.id}
                  className="ws-row"
                  tabIndex={0}
                  onClick={(event) => {
                    if (!event.target.closest('a')) open(project);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.target === event.currentTarget) open(project);
                  }}
                >
                  <td>
                    <a className="ws-task-title ws-plain-link" href={`/manager/project?id=${project.id}`}>{project.name}</a>
                    {project.description && <div className="ws-task-sub ws-clamp">{project.description}</div>}
                  </td>
                  <td className="ws-progress-cell"><ProgressBar progress={project.progress} /></td>
                  <td>{formatDate(project.created_at)}</td>
                  <td className="ws-chevron-cell"><Icon name="chevron" size={16} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal title="New project" onClose={() => setCreating(false)}>
          <ProjectForm onSubmit={createProject} onCancel={() => setCreating(false)} />
        </Modal>
      )}
    </>
  );
}

export default function ManagerProjects() {
  return (
    <Shell role="Manager" title="Projects">
      <ProjectsContent />
    </Shell>
  );
}