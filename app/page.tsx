export default function Page() {
  return (
    <main className="coming-soon">
      <picture className="coming-soon-mark">
        <source media="(prefers-color-scheme: dark)" srcSet="/brand/wizzy-mascot-dark.svg" />
        <img src="/brand/wizzy-mascot-light.svg" alt="Wizzy" />
      </picture>
      <p>Coming soon</p>
    </main>
  );
}
