---
eleventyNavigation:
  key: wrong-response
  title: The Response to the Wrong Request
  parent: debugging-stories
  excerpt: |
    I encountered this in my work at Segovia. It appeared quite rarely, and everyone's best efforts at debugging turned up nothing. For all I know it's still happening. When I left the company, I wrote in the internal bug tracker that if anyone ever solves this mystery, they are to contact me and tell me what the hell was going on, or else I'll be haunted forever.

    I write this story with the faint hope that someone will read it, recognize this problem, and finally give me some closure.
layout: general.html
---

## Symptom

The bug was in a microservice that we'll call "Wrangler" for our purposes here. It exposed an HTTP interface internally, which was called from the main server application.

Very rarely --- as in once every few weeks --- the main app would throw an error that seemed to indicate that Wrangler had returned a response that looked to be for another request entirely. Wrangler had several endpoints and returned a different shape of JSON from each; in these rare instances, it would appear that a request to endpoint `A` had returned a response in the shape of a response from endpoint `B`.

## Background

- Wrangler ran on Node.js, inside Docker containers on EC2 instances.
- The bug occurred on Node 12 and Node 14, with no obvious difference in frequency or nature. (They've hopefully upgraded to Node 16 by now --- it was released shortly after I left the company --- but either way, I don't know if the bug is still happening.)
- Wrangler used Node's [http.server](https://nodejs.org/docs/latest-v14.x/api/http.html#http_class_http_server) API for serving HTTP. (No Express or anything.)
- Each Wrangler instance's purpose is to talk to an instance of an external service that can only do one thing at a time. Therefore, it processed incoming requests serially: it wouldn't return from the `http.Server`'s `request` event handler until it had written and closed out the response. Incoming connections were accepted immediately, but only one request would get worked on at a time; the others would hang until it was their turn. The main application server's Wrangler-calling code was written with extremely generous timeouts for this reason.
- There were multiple Wrangler endpoints that produced this bug, and it happened on multiple different Wrangler instances (each tied to different external services).
- Traffic to Wrangler from the main app was generally quite low, but bursty; a lot of it happened as part of scheduled jobs.
- Traffic was direct from the main app to Wrangler; no load balancers or anything in between (other than the behind-the-scenes AWS network infra).

## Debugging

The main server app (the client of Wrangler) already had full logging of all the HTTP requests it made, and their responses. What that indicated was that when the bug happened, there were two requests going to Wrangler near-simultaneously:

- Request 1 went to endpoint `A`, and hung with no response until timing out.
- Request 2 went to endpoint `B`, on the same Wrangler instance as Request 1, and got a response that looked like it was meant for Request 1.

These requests were coming from _different_ instances of the main app, on different EC2 hosts, so there was no possibility that it was some kind of mixup there. The problem had to be on the Wrangler side.

This bug was kind of a worst-case scenario for debugging because there was no apparent way to repro it on-demand, and it occurred very rarely in the wild. It was essentially impossible to "catch it in the act", and you might have to wait for weeks until your next chance to confront it.

In these situations, your only real option is to blanket the offending code with logging, wait for the bug to happen again, and sift through the piles of log messages.

What our Wrangler-side logging indicated was:

- Request 1 got handled first. It was serviced as normal, and the correct response body was written into the `http.ServerResponse`. The response object's `socket` had the correct remote address: the same as the address the request had come from. The response got sent (according to its `finish` event) and closed out as normal.
- Request 2 then got handled. It was serviced as normal, but then when it came time to send the response, there was an error. (Unfortunately I don't remember the specific error here; I feel like it was "socket already closed" but I can't be sure.)

That seems to point to the two requests' sockets somehow getting swapped. Request 1's response got written to Request 2's socket, and then Request 2's response couldn't be written anywhere. Meanwhile nothing was written to Request 1's socket, and the client timed out.

I put logging everywhere I could reach, but nowhere in the resulting messages did we see any kind of mismatch. The request body, response body, and socket remote addresses always matched.

I tried repro'ing by making lots of simultaneous requests from a script, but it never worked. The bug just continued to happen once every few weeks in production.

I started reading the Node.js `http.server` code, but didn't spend too long on it --- this bug just wasn't worth spending hours and hours on --- so I can't make any definitive conclusions from that.

We upgraded Wrangler from Node 12 to Node 14 partially as a "maybe this will fix it" kind of measure, but as noted above, it didn't work.

## (Unsatisfying) Conclusion

I'm left with two contradictory conclusions:

- I cannot come up with a theory where the bug is in our code that isn't ruled out by the evidence.
- Node's HTTP server library is in extremely heavy use in the wider world, and if there really were a race condition that caused a bug like this, it's unimaginable that we would have been the first to hit it.

Everything about this bug looks like a race condition in the HTTP server infrastructure, but I feel like, practically, it _can't_ be. I just can't imagine what else it _could_ be.
