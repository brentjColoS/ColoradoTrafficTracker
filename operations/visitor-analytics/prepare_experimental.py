"""Opt in only an archived experimental build context, never a source checkout."""
import argparse
from pathlib import Path

MARKER = '<meta name="ctt-visitor-endpoint" content="/dashboard-experimental-events">'


def enable_html(html):
    if MARKER in html: return html
    if 'visitor-events.js?v=visitor-events-2' not in html or '</head>' not in html:
        raise ValueError('Missing verified collector asset or HTML head')
    html=html.replace('<meta name="ctt-visitor-endpoint" content="/visitor-events">','')
    return html.replace('</head>', MARKER+'\n</head>', 1)


def prepare(directory):
    directory = Path(directory).resolve()
    if any((parent/'.git').exists() for parent in (directory,*directory.parents)):
        raise ValueError('Use a disposable Git archive/build context, not a checkout')
    pages = [directory/(name+'.html') for name in ('index','system','data','api')]
    changed = [(page,enable_html(page.read_text())) for page in pages]
    for page, html in changed: page.write_text(html)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    prepare(parser.parse_args().directory)
