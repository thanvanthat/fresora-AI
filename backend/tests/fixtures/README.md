# Test fixtures

`multi_fruit.jpg` — bananas, apples and oranges in one frame, resized to 416px
(the detector's input size, so nothing useful is lost). Used to exercise
multi-item detection end to end, including from the browser: GitHub serves raw
files with `Access-Control-Allow-Origin: *`, so a deployed web build can fetch
it cross-origin during a UI test.

Source: Wikimedia Commons, "Culinary fruits front view", freely licensed.
