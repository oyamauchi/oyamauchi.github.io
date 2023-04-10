---
eleventyNavigation:
  key: debugging-stories
  title: Debugging Stories
  parent: home
layout: general.html
---

I've had to debug some interesting problems in my time. These are some of the ones I can remember. I'll continue adding to these as I think of them.

{% assign stories = collections.all | eleventyNavigation: "debugging-stories" %}
{% for story in stories %}

### [{{ story.title }}]({{ story.url }})

{{ story.excerpt }}

{% endfor %}
