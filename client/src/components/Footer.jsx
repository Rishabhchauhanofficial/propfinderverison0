import { Link } from 'react-router-dom';

const POPULAR_CITIES = ['Mumbai', 'Bengaluru', 'Delhi', 'Gurugram', 'Pune', 'Noida'];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container footer__grid footer__grid--4">
        <div>
          <div className="brand brand--light">
            <span className="brand__mark" aria-hidden="true">PF</span>
            <span className="brand__name">PropFinder</span>
          </div>
          <p className="footer__blurb">
            Property search with the evidence attached: nearby facilities, price vs comparable listings, RERA status and moderated reviews.
          </p>
        </div>

        <div>
          <h4 className="footer__heading">Explore</h4>
          <ul className="footer__list">
            <li><Link to="/buy">Buy</Link></li>
            <li><Link to="/rent">Rent</Link></li>
            <li><Link to="/commercial">Commercial</Link></li>
            <li><Link to="/projects">New projects</Link></li>
            <li><Link to="/assistant">AI assistant</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="footer__heading">Trust & help</h4>
          <ul className="footer__list">
            <li><Link to="/methodology">How scores work</Link></li>
            <li><Link to="/rera">RERA & legal checklist</Link></li>
            <li><Link to="/post">Post property free</Link></li>
            <li><Link to="/contact">Contact & support</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="footer__heading">Popular cities</h4>
          <ul className="footer__list footer__list--inline">
            {POPULAR_CITIES.map((city) => (
              <li key={city}>
                <Link to={`/buy?city=${encodeURIComponent(city)}`}>{city}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="container footer__bottom">
        <span>© {year} PropFinder.</span>
        <span className="footer__legal">
          AI scores are estimates, not legal, financial or investment advice. Map data © OpenStreetMap contributors.
        </span>
      </div>
    </footer>
  );
}
