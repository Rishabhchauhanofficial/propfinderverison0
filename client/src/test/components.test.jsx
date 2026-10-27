import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ScoreGauge, FairnessBadge } from '../components/AiBadge.jsx';
import { ReraBadge, DemoBadge, EmptyState, ConfidencePill } from '../components/ui.jsx';
import { Markdown } from '../components/chat/ChatPanel.jsx';
import { formatINR, formatPerSqft, labelize } from '../utils/format.js';

vi.mock('../context/ShortlistContext.jsx', () => ({
  useShortlist: () => ({ isFavorite: () => false, toggleFavorite: vi.fn(), inCompare: () => false, toggleCompare: vi.fn() }),
}));
const { default: PropertyCard } = await import('../components/PropertyCard.jsx');

describe('format utils', () => {
  it('formats Indian prices', () => {
    expect(formatINR(7500000)).toBe('₹75 Lakh');
    expect(formatINR(25000000)).toBe('₹2.5 Crore');
    expect(formatINR(45000, 'rent')).toBe('₹45,000/mo');
    expect(formatPerSqft(12345)).toBe('₹12,345/sq ft');
    expect(labelize('builder-floor')).toBe('Builder Floor');
  });
});

describe('ScoreGauge', () => {
  it('shows a score', () => {
    render(<ScoreGauge score={72} />);
    expect(screen.getByRole('img', { name: 'Score 72 out of 100' })).toBeInTheDocument();
  });
  it('never renders missing data as zero', () => {
    render(<ScoreGauge score={null} />);
    expect(screen.getByRole('img', { name: /insufficient data/i })).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('badges', () => {
  it('uses honest RERA wording', () => {
    render(<ReraBadge status="verified" />);
    expect(screen.getByText('RERA verified')).toBeInTheDocument();
    expect(screen.queryByText(/approved/i)).toBeNull();
  });
  it('renders nothing for unknown/absent RERA status', () => {
    const { container } = render(<ReraBadge status="not-provided" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('labels price verdicts', () => {
    render(<FairnessBadge verdict="insufficient-data" />);
    expect(screen.getByText('Not enough comparables')).toBeInTheDocument();
  });
  it('labels demo data and confidence', () => {
    render(<><DemoBadge /><ConfidencePill level="none" /></>);
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });
});

describe('Markdown (chat)', () => {
  it('renders bold and bullets without injecting HTML', () => {
    const { container } = render(<Markdown text={'**Hello** <img src=x onerror=alert(1)>\n- one\n- two'} />);
    expect(container.querySelector('strong').textContent).toBe('Hello');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('PropertyCard', () => {
  const p = { id: 'abc', slug: 'nice-flat', title: '2 BHK Apartment in Baner, Pune', price: 9000000, listingType: 'sale', pricePerSqft: 9000, areaSqft: 1000, bedrooms: 2, bathrooms: 2, propertyType: 'apartment', city: 'Pune', locality: 'Baner', images: [], isDemo: true, owner: { name: 'Agent X', role: 'agent' } };
  it('shows price, demo badge and links to the slug', () => {
    render(<MemoryRouter><PropertyCard property={p} /></MemoryRouter>);
    expect(screen.getByText('₹90 Lakh')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    for (const a of screen.getAllByRole('link', { name: p.title })) expect(a).toHaveAttribute('href', '/property/nice-flat');
    expect(screen.getByRole('button', { name: 'Save to shortlist' })).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders an action', () => {
    const onClick = vi.fn();
    render(<EmptyState title="Nothing here" action={<button onClick={onClick}>Reset</button>}>Try again</EmptyState>);
    fireEvent.click(screen.getByText('Reset'));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('sign-up password rule', () => {
  it('accepts any letter + digit mix of 8+ characters (regression: digit check was /d/)', async () => {
    const { passwordProblem } = await import('../utils/validate.js');
    expect(passwordProblem('Secret123')).toBe('');
    expect(passwordProblem('abcdefg1')).toBe('');
    expect(passwordProblem('short1')).not.toBe('');
    expect(passwordProblem('lettersonly')).not.toBe('');
    expect(passwordProblem('12345678')).not.toBe('');
  });
});

describe('MediaPanel', () => {
  it('signed out: says what is hidden and links to sign-in back to this page', async () => {
    const { default: MediaPanel } = await import('../components/MediaPanel.jsx');
    render(
      <MemoryRouter initialEntries={['/property/flat-1']}>
        <MediaPanel item={{ images: ['a', 'b'], media: { locked: true, images: 6, videos: 1, brochures: 2 } }} />
      </MemoryRouter>
    );
    expect(screen.getByText(/4 more photos · 1 video · 2 brochures/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login?redirect=%2Fproperty%2Fflat-1');
  });
  it('signed in: plays videos and links brochures through their signed links', async () => {
    const { default: MediaPanel } = await import('../components/MediaPanel.jsx');
    const { container } = render(
      <MemoryRouter>
        <MediaPanel item={{ media: { locked: false }, videos: [{ url: '/api/media/v.mp4', src: '/api/media/v.mp4?s=1', name: 'Tour' }], brochures: [{ url: '/api/media/b.pdf', src: '/api/media/b.pdf?s=2', name: 'Brochure', size: 389000 }] }} />
      </MemoryRouter>
    );
    expect(container.querySelector('video').getAttribute('src')).toBe('/api/media/v.mp4?s=1');
    expect(screen.getByRole('link', { name: /Brochure/ }).getAttribute('href')).toBe('/api/media/b.pdf?s=2');
    expect(screen.getByText(/380 KB/)).toBeTruthy();
  });
});
