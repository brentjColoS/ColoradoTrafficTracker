![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

My name is Brent Jackson. I live in Fort Collins and earned my BS in Computer
Science from Colorado State University in December 2025.

I enjoy backend development, especially working with data and the services
behind an application. The drives home from snowboarding at Keystone led to
Colorado Traffic Tracker, which I develop and maintain independently.
The [project journey](Project-Journey) has the full story behind it. You should check it out.

## How I build

I start by understanding the problem, reading the existing code and checking
my assumptions against what the system actually does. Then I break the work
into changes I can explain and test. In CTT, working within a limited provider
allowance led me to separate collection from dashboard requests so browsing
history wouldn't spend the budget needed to gather it.

When something breaks, I work to reproduce it, trace the cause and add a check
that will catch it again. Tests for provider failures and expired caches help
me make changes without losing behavior the project already depends on.

I use LLM tools for debugging, tests, refactoring and documentation, and take
responsibility for the code I keep. That means understanding the result,
reviewing it and verifying its behavior.

Those are the habits I want to bring to a junior engineering role. On a team,
I want to make my work easy to review, ask questions when I'm missing context
and use feedback to improve the next change.

## Other projects

At home, I built a Python climate controller on a Raspberry Pi to automate a
fan and humidifier through smart plugs. It logs temperature and humidity from
a DHT22 sensor and uses those readings to control the equipment. It runs
without a monitor, with seasonal logic and a manual override for when I want
to change things myself.

To learn network programming, I built a two-player
[tic-tac-toe game](https://github.com/brentjColoS/server-based_tic-tac-toe)
with Python's TCP sockets. Writing the networking and JSON message handling
from scratch meant working through how clients and a server exchange moves,
keep a shared game state and support player chat. It gave me a practical
understanding of concepts I'd studied in class.

I also worked on a
[company management application](https://github.com/brentjColoS/CS415-SP25)
with a six-person university team, leading automated testing with JUnit and
mutation testing.

## People, code and design

Outside software, my background includes operations management and staff
training in retail and hospitality. I've coached teams, developed training
programs and worked through the everyday problems of keeping a business
running.

That experience shapes how I work with people, code and design. Explaining a
process means helping someone understand what to do and why, especially when
something goes wrong. Clear names and responsibilities serve a similar purpose
in code. In the dashboard, source labels, timestamps and explanations of
missing data help someone understand what they're looking at and decide what
to do next.

<img src="https://raw.githubusercontent.com/wiki/brentjColoS/ColoradoTrafficTracker/images/profile.jpg" alt="Brent Jackson" width="180">

[GitHub](https://github.com/brentjColoS) · [brent.jackson219@gmail.com](mailto:brent.jackson219@gmail.com)

[← Project journey](Project-Journey) · [What's next →](Roadmap)
