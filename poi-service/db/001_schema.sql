CREATE TABLE pois (
  id      text PRIMARY KEY,
  lat     double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng     double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius  integer NOT NULL CHECK (radius >= 30) -- GPS sai số vài mét tới vài chục mét
);
