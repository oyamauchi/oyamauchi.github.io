---
eleventyNavigation:
  key: debugging-stories
  title: Debugging Stories
  parent: home
layout: general.html
---

I've had to debug some interesting problems in my time. These are some of the ones I can remember. I'll continue adding to these as I think of them.

{% for story in collections.debugging %}

### [{{ story.data.eleventyNavigation.title }}]({{ story.url }})

{{ story.data.summary }}

{% endfor %}
