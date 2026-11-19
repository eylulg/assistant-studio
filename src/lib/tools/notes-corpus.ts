export interface Note {
  id: string;
  title: string;
  tags: string[];
  body: string;
}

/** A small, made-up personal notebook. It is the whole corpus search_notes can see. */
export const NOTES: readonly Note[] = [
  {
    id: 'note-01',
    title: 'Sourdough starter feeding schedule',
    tags: ['baking', 'food'],
    body: 'Feed the starter every 12 hours at room temperature: equal weights of starter, flour and water. If it smells sharp like nail polish it is hungry, so feed it twice a day for three days. Keep a spare jar in the fridge and feed it weekly.',
  },
  {
    id: 'note-02',
    title: 'Lisbon trip packing list',
    tags: ['travel', 'lists'],
    body: 'Comfortable walking shoes for the hills and cobblestones, a light rain jacket, sunscreen, a power adapter (type F), a reusable water bottle and a small day bag. Trams are crowded, so keep valuables in a front pocket.',
  },
  {
    id: 'note-03',
    title: 'Quarterly planning meeting: decisions',
    tags: ['work', 'meetings'],
    body: 'We agreed to ship the onboarding rewrite before the reporting work. Mira owns the onboarding scope, Jonas owns the migration plan. Open question: whether to hire a second designer in the spring. Next review is the first Monday of the quarter.',
  },
  {
    id: 'note-04',
    title: 'Thinking in Systems, reading notes',
    tags: ['books', 'learning'],
    body: 'Stocks are what accumulates, flows change them. Balancing loops stabilise a system and reinforcing loops make it grow or collapse. Leverage points are usually places where people push in the wrong direction. Change the goals and rules before tuning the numbers.',
  },
  {
    id: 'note-05',
    title: 'Bike maintenance checklist',
    tags: ['bike', 'lists'],
    body: 'Check tyre pressure every two weeks (4.5 bar on the road bike). Lube the chain after every wet ride. Inspect brake pads each month and replace them when the wear line is gone. Tighten the stem bolts to 5 Nm and the saddle clamp to 6 Nm.',
  },
  {
    id: 'note-06',
    title: 'Lentil soup recipe',
    tags: ['food', 'recipes'],
    body: 'Fry one chopped onion, two carrots and garlic in olive oil. Add 250 g red lentils, one litre of vegetable stock, cumin and a pinch of chilli. Simmer for 25 minutes, blend half of it and finish with lemon juice. Serves four.',
  },
  {
    id: 'note-07',
    title: 'Weekly review template',
    tags: ['productivity', 'template'],
    body: 'What did I finish? What slipped and why? What is the one thing that would make next week a success? Clear the inbox, check the calendar for the next two weeks and move unfinished tasks forward or delete them.',
  },
  {
    id: 'note-08',
    title: 'Learning Norwegian: first phrases',
    tags: ['languages', 'learning'],
    body: 'God morgen (good morning), takk (thanks), unnskyld (sorry or excuse me), hvor er togstasjonen? (where is the train station?). The letter combinations kj and skj are the hardest sounds. Practise ten minutes every day instead of one long session.',
  },
  {
    id: 'note-09',
    title: 'Learning Dutch: market vocabulary',
    tags: ['languages', 'learning'],
    body: 'Een kilo appels, alstublieft. Hoeveel kost dit? Mag ik een zak? Contant of pinnen? Stroopwafels are sold warm at the Albert Cuyp market. Remember that Dutch people often switch to English, so ask politely to keep practising.',
  },
  {
    id: 'note-10',
    title: 'Istanbul food list',
    tags: ['travel', 'food'],
    body: 'Breakfast with menemen and simit, fish sandwiches by the Galata Bridge, lahmacun in Karakoy, baklava and Turkish coffee in the afternoon. Take the ferry between Europe and Asia at sunset. Most small restaurants prefer cash.',
  },
  {
    id: 'note-11',
    title: 'Design review feedback: settings page',
    tags: ['work', 'design'],
    body: 'The save button was hidden below the fold on small screens. Labels were placeholders, so they disappeared while typing. Error messages said what went wrong but not what to do next. Fix order: labels, error copy, sticky save bar.',
  },
  {
    id: 'note-12',
    title: 'Monthly budget rules',
    tags: ['money', 'lists'],
    body: 'Fixed costs under half of income, savings first on payday, and one flexible category with a hard cap. Review subscriptions every quarter and cancel anything unused for two months. Keep three months of expenses in an easy-access account.',
  },
  {
    id: 'note-13',
    title: 'Garden plan for spring',
    tags: ['garden', 'plans'],
    body: 'Sow tomatoes indoors in March and move them out after the last frost. Peas and radishes can go straight into the ground in April. Plant basil next to the tomatoes. Put the compost bin in the shaded corner near the fence.',
  },
  {
    id: 'note-14',
    title: 'Password hygiene tips',
    tags: ['security', 'lists'],
    body: 'Use a password manager and a unique password for every site. Turn on two-factor authentication with an app instead of SMS where possible. Never reuse the email account password. Check the breach notifications and rotate the affected passwords the same day.',
  },
  {
    id: 'note-15',
    title: 'Standup format',
    tags: ['work', 'template'],
    body: 'Yesterday, today, blocked. Keep it under 90 seconds each and take detailed discussion to a thread afterwards. Name blockers early and say who can unblock them. Skip the standup on days with a planning session.',
  },
  {
    id: 'note-16',
    title: 'Retro action items, sprint 14',
    tags: ['work', 'meetings'],
    body: 'Write acceptance criteria before starting a ticket. Add a smoke test to the release checklist. Pair on the flaky upload test instead of retrying it. Owner for each item: whoever raised it. Check progress at the next retro.',
  },
  {
    id: 'note-17',
    title: 'Kyoto itinerary draft',
    tags: ['travel', 'plans'],
    body: 'Day one: Fushimi Inari early in the morning before the crowds. Day two: Arashiyama bamboo grove and the river walk. Day three: Nishiki Market and the Gion district at dusk. Buy a transport pass for buses and book the tea ceremony in advance.',
  },
  {
    id: 'note-18',
    title: 'Running plan: 10 km in eight weeks',
    tags: ['fitness', 'plans'],
    body: 'Run three times a week: one easy run, one interval session, one long run. Add one kilometre to the long run every week, with an easier week after every third. Strength work on one other day. Sleep matters more than an extra run.',
  },
  {
    id: 'note-19',
    title: 'Accessibility checklist for forms',
    tags: ['work', 'accessibility'],
    body: 'Every input has a visible label bound to it. Errors are linked with aria-describedby and say how to fix the problem. Focus moves to the first error on submit. Required fields are marked in text, not only by colour. Test with the keyboard before testing with a screen reader.',
  },
  {
    id: 'note-20',
    title: 'Book list for the winter',
    tags: ['books', 'lists'],
    body: 'A long novel for the dark months, one book about the history of cities, one about writing well, one about the sea. Keep a paper notebook for quotes. Aim for twenty pages every evening instead of finishing quickly.',
  },
  {
    id: 'note-21',
    title: 'Coffee brewing ratios',
    tags: ['food', 'recipes'],
    body: 'Pour over: 60 g of coffee per litre of water, water at 94 degrees Celsius, three minutes. French press: 4 minutes then plunge slowly. Espresso: 18 g in, 36 g out in 28 seconds. Grind finer if the cup tastes sour, coarser if bitter.',
  },
  {
    id: 'note-22',
    title: 'Moving apartments checklist',
    tags: ['home', 'lists'],
    body: 'Give notice to the landlord and the energy provider six weeks ahead. Update the address with the bank, insurance, employer and tax office. Take meter readings with photos on both days. Label boxes by room and keep a box of essentials for the first night.',
  },
  {
    id: 'note-23',
    title: 'Interview prep: product designer role',
    tags: ['work', 'career'],
    body: 'Prepare three stories with a clear before and after: a flow that was simplified, a disagreement that ended well, and a mistake that taught something. Bring numbers where there are any. Ask what the first ninety days look like and how design decisions get made.',
  },
  {
    id: 'note-24',
    title: 'Oslo weekend ideas',
    tags: ['travel', 'plans'],
    body: "Swim in the fjord at Sorenga, walk through the Vigeland sculpture park, visit the Munch museum and take the metro up to Frognerseteren for the view. Cafes close early on Sundays, so plan lunch around one o'clock.",
  },
  {
    id: 'note-25',
    title: 'Photography basics',
    tags: ['hobbies', 'learning'],
    body: 'Shoot in the first and last hour of daylight. Use the rule of thirds as a starting point, then break it on purpose. Keep the ISO as low as the light allows and the shutter speed above one over the focal length to avoid blur.',
  },
  {
    id: 'note-26',
    title: 'Code review etiquette',
    tags: ['work', 'engineering'],
    body: 'Review the change, not the person. Say why, link to an example and offer a suggestion. Mark nits as optional. Approve when the remaining comments are minor. A reviewer should reply within one working day, even if only to say when they will look.',
  },
  {
    id: 'note-27',
    title: 'Sleep routine experiment',
    tags: ['health', 'plans'],
    body: 'Same wake-up time every day, no screens for the last 30 minutes, the room at 18 degrees Celsius and a short walk after dinner. Track the mood and energy on a scale of one to five. Review after two weeks before changing anything.',
  },
  {
    id: 'note-28',
    title: 'Birthday gift ideas',
    tags: ['lists', 'personal'],
    body: 'A hand-bound notebook for Deniz, a good pocket knife for Arne, a ceramic pour-over set for Ilse, a framed print of the old harbour for Mum. Order anything custom at least three weeks ahead.',
  },
  {
    id: 'note-29',
    title: 'Conference talk outline: designing for streaming UIs',
    tags: ['work', 'talks'],
    body: 'Open with a stream that stalls. Cover the three states users care about: working, finished and interrupted. Show how Stop keeps the partial answer, why a disconnect is not an error and how to ask before an action with side effects. End with measuring time to first token.',
  },
  {
    id: 'note-30',
    title: 'Home server setup notes',
    tags: ['tech', 'home'],
    body: 'A small mini PC running a media library and backups. Snapshot the data disk nightly and copy the snapshot to an external drive weekly. Keep the router firmware updated and put the server on its own network segment. Test a restore once a quarter.',
  },
];
