export default function BrandMark({ large = false }) {
  return (
    <div className={`brand-lockup ${large ? 'large' : ''}`}>
      <div className="classfocus-brand-group">
        <div className="brand-emblem" aria-hidden="true"><span>CF</span></div>
        <div className="brand-copy">
          <strong>ClassFocus</strong>
          <small>Plataforma académica</small>
        </div>
      </div>

      <div className="brand-divider" aria-hidden="true" />

      <div className="uspg-logo-panel" title="Universidad San Pablo de Guatemala">
        <img
          src={`${import.meta.env.BASE_URL}uspg-logo-full.png`}
          alt="Universidad San Pablo de Guatemala"
        />
      </div>
    </div>
  )
}
