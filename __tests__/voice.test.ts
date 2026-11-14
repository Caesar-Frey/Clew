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
    ['gave the tent to Priya until next month', 'Tent', 'Priya', 30],
    ['Sam has the step ladder', 'Step ladder', 'Sam', null],
    ['Priya borrowed my book for 10 days', 'Book', 'Priya', 10],
  ])('%s', (text, name, person, days) => {
    expect(parseSpokenCard(text)).toEqual({ name, place: [], person, dueInDays: days });
  });
});

describe('spokenQuery', () => {
  it.each([
    ["where's my passport", 'passport'],
    ['Where are the Christmas lights?', 'Christmas lights'],
    ['where did I put the drill', 'drill'],
    ['find spare keys', 'spare keys'],
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
