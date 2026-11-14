import { buildLocationIndex } from '../src/lib/locations';
import { parseSpokenCard, resolveSpokenPlace, spokenQuery } from '../src/voice/parse';
import { testRepo } from './testDb';

describe('parseSpokenCard', () => {
  it.each([
    ['The passport is in the desk drawer', 'Passport', ['Desk drawer']],
    ['my passport is in the desk drawer in the bedroom.', 'Passport', ['Bedroom', 'Desk drawer']],
    ['I put the Christmas lights in the attic', 'Christmas lights', ['Attic']],
    ['okay so the spare keys are in the key bowl on the hallway table', 'Spare keys', ['Hallway table', 'Key bowl']],
    ['camping stove in blue box in the garage', 'Camping stove', ['Garage', 'Blue box']],
    ['the suitcase is under the bed', 'Suitcase', ['Under the bed']],
    ['winter coats are under the stairs in the hallway', 'Winter coats', ['Hallway', 'Under the stairs']],
    ['drill garage greater than tool shelf', 'Drill garage greater than tool shelf', []],
    ['the drill is in garage > tool shelf', 'Drill', ['Garage', 'Tool shelf']],
    ['HDMI cable', 'HDMI cable', []],
  ])('%s', (text, name, place) => {
    const card = parseSpokenCard(text);
    expect(card.name).toBe(name);
    expect(card.place).toEqual(place);
    expect(card.person).toBeNull();
  });

  it.each([
    ['I lent the drill to Sam', 'Drill', 'Sam', null],
    ['lent my ladder to uncle bob for two weeks', 'Ladder', 'Uncle Bob', 14],
    ['gave the tent to Priya for a month', 'Tent', 'Priya', 30],
    ['Sam has the step ladder', 'Step ladder', 'Sam', null],
    ['Priya borrowed my book for 10 days', 'Book', 'Priya', 10],
  ])('%s', (text, name, person, days) => {
    expect(parseSpokenCard(text)).toEqual({ name, place: [], person, dueInDays: days });
  });
});

describe('parseSpokenCard: lending forms and due dates (P2-7)', () => {
  // Wednesday 11 November 2026, midday in London.
  const now = new Date(2026, 10, 11, 12).getTime();
  const card = (text: string) => parseSpokenCard(text, now);

  it.each([
    ['I lent the drill to Sam for a couple of weeks', 14],
    ['lent the tent to Priya for a few days', 3],
    ['lent the saw to Sam until Friday', 2],
    ['lent the saw to Sam on Friday', 2],
    ['lent the saw to Sam until next Friday', 9],
    ['lent the saw to Sam until Monday', 5],
    ['lent the saw to Sam until next Monday', 5],
    ['lent the saw to Sam till the weekend', 3],
    ['lent the saw to Sam until next week', 5],
    ['lent the saw to Sam till the end of the month', 19],
    ['lent the saw to Sam until next month', 30],
    ['lent the saw to Sam until tomorrow', 1],
  ])('%s -> due in %i days', (text, days) => expect(card(text).dueInDays).toBe(days));

  it('reads "I lent Sam the drill"', () => {
    expect(card('I lent Sam the drill')).toEqual({ name: 'Drill', place: [], person: 'Sam', dueInDays: null });
  });

  it('reads "the drill is with Sam", but not "with the documents"', () => {
    expect(card('the drill is with Sam')).toMatchObject({ name: 'Drill', person: 'Sam' });
    expect(card('the passport is with the documents').person).toBeNull();
  });

  it('keeps several borrowers as one string and still reads the due phrase', () => {
    expect(card('I lent the tent to Sam and Priya for two weeks')).toEqual({
      name: 'Tent',
      place: [],
      person: 'Sam and Priya',
      dueInDays: 14,
    });
  });

  it('leaves the name empty for "it" so the user is asked', () => {
    expect(card('I lent it to Sam')).toMatchObject({ name: '', person: 'Sam' });
    expect(card('put it in the garage')).toMatchObject({ name: '', place: ['Garage'] });
  });

  it('keeps "on the left" as part of the place', () => {
    expect(card('the tent is in the shed on the left').place).toEqual(['Shed on the left']);
    expect(card('the tape is in the drawer on the right in the kitchen').place).toEqual(['Kitchen', 'Drawer on the right']);
  });

  it('is calendar-aware across month ends', () => {
    const jan31 = new Date(2027, 0, 31, 12).getTime();
    expect(parseSpokenCard('lent the saw to Sam until next month', jan31).dueInDays).toBe(28);
    expect(parseSpokenCard('lent the saw to Sam till the end of the month', jan31).dueInDays).toBe(28);
  });
});

describe('spokenQuery', () => {
  it.each([
    ["where's my passport", 'passport'],
    ['Where are the Christmas lights?', 'Christmas lights'],
    ['where did I put the drill', 'drill'],
    ['find spare keys', 'spare keys'],
    ['where can I find the tent', 'tent'],
    ['Do you know where my passport is?', 'passport'],
    ["where's the drill at", 'drill'],
    ['have you seen my glasses', 'glasses'],
    ['wheres the charger', 'charger'],
    ['drill', 'drill'],
    ['the blue box', 'blue box'],
  ])('%s', (text, q) => expect(spokenQuery(text)).toBe(q));
});

describe('resolveSpokenPlace', () => {
  it('finds existing nested places from the spoken leaf', async () => {
    const { repo } = await testRepo();
    await repo.ensureLocationPath(['House', 'Garage', 'Blue box']);
    await repo.ensureLocationPath(['Office', 'Blue box']);
    await repo.ensureLocationPath(['House', 'Bedroom', 'Desk drawer']);
    const locs = await repo.listLocations();
    const index = buildLocationIndex(locs);
    expect(resolveSpokenPlace(['Desk drawer'], locs, index)).toEqual(['House', 'Bedroom', 'Desk drawer']);
    expect(resolveSpokenPlace(['Garage', 'Blue box'], locs, index)).toEqual(['House', 'Garage', 'Blue box']);
    expect(resolveSpokenPlace(['Office', 'the blue box'], locs, index)).toEqual(['Office', 'Blue box']);
    expect(resolveSpokenPlace(['Attic', 'Blue box'], locs, index)).toEqual(['Attic', 'Blue box']);
    expect(resolveSpokenPlace(['Shed'], locs, index)).toEqual(['Shed']);
  });
});
