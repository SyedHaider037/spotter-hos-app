import { decodePolyline } from './polyline';

test('decodes the reference polyline from the encoding spec', () => {
  // Example from Google's encoded polyline algorithm documentation.
  expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

test('returns an empty array for empty or non-string input', () => {
  expect(decodePolyline('')).toEqual([]);
  expect(decodePolyline(undefined)).toEqual([]);
  expect(decodePolyline(null)).toEqual([]);
});

test('ignores a truncated trailing pair instead of throwing', () => {
  const full = decodePolyline('_p~iF~ps|U_ulLnnqC');
  expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqN')).toEqual(full);
});
