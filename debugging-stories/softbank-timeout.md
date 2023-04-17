---
eleventyNavigation:
  key: softbank-timeout
  title: The SoftBank Timeout
  parent: debugging-stories
  excerpt: |
    An adventure into the world of Japanese cell phones in 2012, during my time at Facebook.
layout: general.html
include_hljs: true
---

## Background

Before we can get into the details of this bug, here's a quick overview of the Japanese mobile web landscape of the time.

Even at the time, roughly four years after the release of the iPhone in Japan, flippy feature phones were widespread. The common saying is that they were the "Galápagos finches" of phones: having evolved on an island, isolated from outside competition or interoperability concerns, they went in some weird directions.

Also known as _keitai_, these phones were far ahead of their time in some ways. They had decent cameras before that was common in the rest of the world. Some of them had the ability to watch broadcast TV via a little antenna. They could do NFC payments. Many were waterproof.

Most relevantly to our story here, they had web browsers. You may remember the early days of web browsers on cell phones: they were utter garbage, and it was a stretch to call them web browsers at all. They certainly had no hope of rendering an unmodified desktop site; they were basically confined to a crappy alternate "mobile web".

Japanese phone browsers were more capable --- they even had rudimentary JavaScript engines! --- but they were very idiosyncratic. Each of the three major carriers (NTT DoCoMo, KDDI, and SoftBank[^softbank]) made their own phones, top-to-bottom: hardware, OS, apps. Each carrier's phones thus had a bespoke web browser, each with its own weird quirks and capabilities.

In 2010, Facebook's userbase was skyrocketing across the developed world. Japan was a notable exception: the userbase was tiny and growth was stagnant. So the company sent an engineering team to work in Japan long-term[^me], with a mission to grow the site's userbase there. The first thing they noticed was that Facebook's [mobile site](https://m.facebook.com), built for the feature phones of the rest of the world, was completely broken on Japanese feature phones: it just showed up blank[^eng].

[^eng]: Apparently, nobody at the company had noticed before. My guess is that all the Facebook employees who'd set foot in Japan up until that point had been using only smartphones.
[^me]: I wasn't part of this initial wave. The first three engineers went over in mid-2010, followed by another two in early 2011 (just days before the [Tohoku earthquake](https://en.wikipedia.org/wiki/2011_T%C5%8Dhoku_earthquake_and_tsunami)), followed by me in October 2011.

So one of the first things the Japan engineering team did was to make a bunch of adaptations to the mobile site, for requests coming from Japanese mobile carriers. There were design changes and technical changes. That predated my time there, so I unfortunately don't remember many of them.

The mobile site then started seeing real usage, and that brings us to the actual debugging story.

[^softbank]: Yes, _that_ SoftBank, the one that poured a bajillion dollars into the money pits of WeWork, Uber, etc. Well, the carrier and the Vision Fund are both subsidiaries of the overarching SoftBank Group.

## Symptom

We started getting reports from users that they couldn't load the mobile site. It quickly became clear that all the reporting users were on SoftBank. They all had the same story: the browser would hang for a while, then display a message along the lines of "the request took too long, please try again later".

We immediately repro'ed it with SoftBank phones in the office, and furthermore found that the hang was precisely 50 seconds long every time. The other carriers' phones loaded the site just fine.

## Debugging

### Size limit?

Of the three carriers, SoftBank's feature phone web browser was by far the most finicky. For one thing, they had a hard limit on the size of the page's HTML: 48KB. If the HTML was even one byte over the limit, the browser would just show the error message "invalid data". Fairly regularly, some other team's change to the mobile site would cause it to exceed this limit. This happened so frequently that we had specific monitoring and alerting for "`home.php` page size on SoftBank", and a config setting to let us drastically reduce the number of News Feed stories shown on SoftBank specifically.

With that experience fresh in our minds, our first hypothesis was that the same thing was happening again. But it was easily ruled out: the problem happened on every page of the site, even ones with little or no dynamic content, and we could see in our desktop browsers that those pages weren't too big. This also wouldn't account for the 50-second hang.

### Broken HTML?

These feature phone browsers were quirky enough that we thought there might be a newly added bit of markup on the page that the SoftBank phone browser couldn't handle. Similar things were among the reasons why the mobile site had been totally broken before the engineering team's arrival in Japan, so this felt like a plausible theory. (In retrospect, like the size-limit theory, this wouldn't explain the 50-second hang.)

To investigate that, we hit one of our development servers[^devserver] from a SoftBank feature phone. The site rendered just fine. That meant there was nothing wrong with the site's HTML across the board.

[^devserver]: The way website development at Facebook worked was that you'd run your checkout of the site's code on a server in a data center, which you could access (over HTTP or SSH) if you were on an office network or on the VPN.

The setup we had for accessing our dev servers from feature phones was, let's say, "interesting"; it involved an obscure new domain name, a Mac mini in the office coat closet, [Squid](<https://en.wikipedia.org/wiki/Squid_(software)>), and `iptables` shenanigans. It was so different from how prod servers were accessed that we thought this wasn't actually a fair test: this weird proxy setup was a confounding variable. Fortunately, we could easily switch the proxy's destination from dev servers to prod, so we did that. Lo and behold: the site rendered just fine.

That conclusively ruled out any theory based on the page's content: we were getting the exact bits of the prod site to the phone, and they rendered just fine. The problem had to be in the network, between the phone and Facebook's prod infrastructure.

### DNS?

The first theory we explored here was that something was failing to resolve `facebook.com` in DNS. So we looked up `facebook.com` on a computer and typed in the resulting IP address on the phone, and it worked: the site showed up.

This felt like a smoking gun, with SoftBank as the culprit. Everyone in the world except SoftBank seemed able to resolve our domain name, so it must be them, right?

In any case, we'd reached the limit of what we could investigate without help. There were, of course, no debugging tools on the phones themselves. They also didn't support Wi-Fi, so we couldn't even put a phone on office Wi-Fi and Wireshark its traffic or anything like that. Everything happening between the phone and the SoftBank data center was completely opaque to us.

The head of the Facebook Tokyo office had a few contacts at SoftBank, but they were business people, not engineers. Furthermore, in a stroke of anti-luck, almost all of them were out of office: they were in Barcelona at Mobile World Congress, a major mobile industry conference[^mwc], and were unreachable for the moment.

[^mwc]: There would have been Facebook employees there too. I think we briefly debated contacting them and asking them to try to track down the SoftBank people, but in the end we didn't.

When you do business in Japan, you'll inevitably amass a huge collection of business cards. Any time you meet someone in a work context, the first thing you'll do is exchange business cards, even if there's zero chance you'll ever interact with them again. The head of the office started going through his collection; after a stressful period of him calling up essentially random SoftBank employees whose business cards we had, he got in touch with a helpful guy who was at least engineering-adjacent. He said he could repro the problem, and that he would ask the network team to look into it, but they hadn't made any network config changes lately.

[^prod]: Code running on a dev server accessed real production services, including databases; there was no other option. Since this was my first job working on a large production web app, my attitude at the time was "that seems kinda weird, oh well". Now I find it deeply, deeply horrifying. Unfortunately, I think it's overwhelmingly likely that FB still works like this, though I don't know for sure.

### Redirects??

By this time, it was getting late, and we weren't sure whether we'd hear back from SoftBank that day. Eventually, though, we did. They sent us a tcpdump from one of their gateway servers (i.e. a proxy; the outermost layer of their infrastructure before going across the Internet to FB). This is what it showed:

1. The gateway received a request for `http://m.facebook.com/` from a phone.
2. The gateway sent an HTTP request for `/` to `m.facebook.com`, apparently having resolved the domain name successfully.
3. Less than a second later, the gateway received a response: a 302 redirect to `http://m.facebook.com/?nocache=<random-stuff>` --- this was a cache-busting technique that Facebook used with some mobile carriers, when we didn't trust their server-side caching to be aware of cookies.
4. 50 seconds later, the gateway sent a 504 (gateway timeout) to the phone.

This conclusively ruled out our DNS theory: obviously, the SoftBank gateway and the Facebook web servers were successfully talking to each other.

The next theory, then, was that something about the redirect was causing problems. To test it, I typed in a URL with a nonempty `nocache` parameter on the phone, so the server should send back an actual webpage instead of a redirect. That got the site to render. Good news for this theory! However, I couldn't find anything wrong with the contents of the redirect response in the tcpdump.

We checked our internal chart of pageview counts from SoftBank --- something we should have done much sooner, really --- and saw that it had only dropped by about 20% from usual levels. This seemed consistent with the "redirects are the problem" theory, since it was plausible that around 20% of total requests to the mobile site would result in redirects; we didn't think too hard about this.

Another thing about the pageview chart: the 20% drop started about an hour after our big weekly code push. I still had no concrete ideas of what could be causing this problem, but the timing seemed suspicious.

We told the SoftBank guy we were still stuck, and he said they'd keep investigating and get back to us. By this time it was late at night, and everyone called it a day. Our working theory as we left the office was that something about the form of our redirect response had changed, and SoftBank's gateway was failing to handle it correctly.

### The Answer!

The next day, we got some more information from SoftBank. They sent us a Wireshark capture of the exchange between their gateway and our load balancer. They also told us their network team's assessment: that our load balancer wasn't sending a `FIN` packet once it was done sending the 302 redirect response.

We consulted with a Facebook network engineer, and sent him the packet capture. He immediately observed that of course we _wouldn't_ send a `FIN` packet (i.e. close the connection), because SoftBank was sending the request as `HTTP/1.1`, which keeps connections alive by default.

Then, finally, I noticed something in the request:

```http
GET / HTTP/1.1
Host: m.facebook.com
User-Agent: <whatever>
Cookie: <whatever>
Accept-Encoding: <whatever>
Connection: close
<et cetera>
```

SoftBank's gateway was _right_ to expect us to close the connection: it was sending the header `Connection: close`. Our load balancer was ignoring it.

It turned out that Facebook had, in fact, started rolling out a new load balancer setup, switching from F5 hardware to [Proxygen](https://github.com/facebook/proxygen), a homegrown software load balancer. They were switching over gradually, and incoming traffic from SoftBank had just gotten switched over; the network team waited until an hour after the code push, to avoid interfering. It hadn't been announced in any of the places we looked for potential instigating events, because by rights it shouldn't have affected anything above the network level.

It's slightly weird that an HTTP client would combine `HTTP/1.1` and `Connection: close`. Any HTTP server should be able to handle that correctly (by obeying the header), but it's just not something you'd see often. One could imagine writing an HTTP server that expected _never_ to see such a thing. It would be incorrect, but one could imagine it.

That's what Proxygen did. Proxygen was basing its end-of-response behavior solely on the HTTP version, not the `Connection` header. So it was holding the connection open after sending the response, while the SoftBank gateway waited for the connection to be closed from the other end. After the connection sat idle for 50 seconds, presumably the SoftBank gateway decided that it hadn't received a complete response and gave up.

Two last threads to tie up:

- Why were only redirects affected? I didn't dig into that at the time. In retrospect, my guess is that it was an issue with empty response bodies. Maybe SoftBank's gateway was able to correctly use a nonzero `Content-Length` header to close connections itself, but not a zero-length one?
- Why did going to the site by IP address work? That was what had sent us down the "DNS problem" path. Again, I didn't look into this at the time, but my guess is that the IP address we resolved on desktop was different from what the SoftBank gateway would have resolved, and resulted in the traffic being routed to a load balancer that hadn't been switched to Proxygen yet.

I should note, too, that the initial tcpdump from SoftBank actually had the answer in it. It's just that at the time, I was so focused on the idea that the _response_ was the problem that I never looked closely at the _request_.

Our network engineer rolled back the load balancer change, and everything started working again. We sheepishly thanked the SoftBank guy for his help and apologized for the chaos.

## Conclusion

I actually don't even know if the Japan mobile site still exists. (There was a way to force it to show up in a non-feature-phone browser, but I forget how.) It was a maintenance headache. It made the mobile site's code more complex, with its `if (is_japan_site())` conditionals all over the place. It was more or less impossible for anyone outside of Japan to test, so it regularly got broken by changes to the worldwide mobile site.

That was the case even with a dedicated engineering team working on it and advocating for it. Then, after I left Japan in late 2021, the Japan engineering team gradually disbanded over a couple of years. It's possible that without anyone specifically tasked with maintaining it, and with the tribal knowledge of all the quirks gone, the Japan mobile site just bit-rotted away, even without an explicit decision to stop supporting it. (To be clear, that's speculation on my part; I have no insider knowledge of anything that's happened since I left the company in early 2016.)

However, feature phone usage in Japan is surprisingly durable, even well into the smartphone era, so I would guess that shutting out feature phones would put a noticeable dent in Japan user numbers. Maybe that doesn't matter, though; Facebook has bigger problems to deal with right now.
