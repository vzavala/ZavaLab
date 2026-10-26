# ZavaLab collaborations

Interactive collaboration network and world map of coauthors of the Scalable Systems Laboratory
(Victor M. Zavala, University of Wisconsin–Madison), published at https://vzavala.github.io/ZavaLab/.

- `index.html`: the collaboration network ("Network" tab)
- `map/index.html`: the world map of coauthoring institutions ("Locations" tab)
- `embed/network/` and `embed/map/`: each figure alone, for embedding in another site. In Google Sites,
  use **Insert → Embed → Embed code**:

  ```html
  <iframe src="https://vzavala.github.io/ZavaLab/embed/network/?min=1" width="100%" height="1300" style="border:0"></iframe>
  <iframe src="https://vzavala.github.io/ZavaLab/embed/map/" width="100%" height="650" style="border:0"></iframe>
  ```

  `?min=` sets the network's starting "at least N joint papers" filter (1, 2, 3, 5, 8 or 10; default 3).

These files are generated from the lab website project (`web/scripts/export-collaborations.py`); edit
the data and figures there, not here. Publication data from [OpenAlex](https://openalex.org).
