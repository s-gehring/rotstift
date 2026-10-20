import { useApp } from './app-context.tsx';

export function SubjectSelect() {
  const { subject, run } = useApp();
  return (
    <label className="subject-select">
      <span className="visually-hidden">Fach</span>
      <select
        value={subject.profile.id}
        disabled={run.running}
        onChange={(event) => {
          const next = subject.profiles.find((profile) => profile.id === event.target.value);
          if (next !== undefined) subject.select(next);
        }}
      >
        {subject.profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.subject}
          </option>
        ))}
      </select>
    </label>
  );
}
