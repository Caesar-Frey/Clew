// Run every test in a time zone with daylight saving, so date maths that
// assumes 24-hour days fails here rather than on someone's phone.
module.exports = async () => {
  process.env.TZ = 'Europe/London';
};
