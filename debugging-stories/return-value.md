---
eleventyNavigation:
  key: return-value
  title: The Disappearing Return Value
  parent: debugging-stories
  excerpt: |
    I hit this at the very beginning of my time working on [HHVM](https://github.com/facebook/hhvm). While working on an unrelated task, I encountered this bizarre symptom, which took me a while to even notice, and then sent me down a very fun rabbit hole to debug.

    Sadly, the bugged revision has vanished from the public HHVM repo; it seems they rewrote history at some point.
layout: general.html
include_hljs: true
---

## Symptom

A return value was disappearing.

There was one function that was returning a value; let's say it was 123. I printf'ed the return value right before returning to make sure it was correct.

But the caller of that function wasn't seeing 123. I printf'ed the received return value immediately after the call, and it was something else.

## Code

Here's an approximation of the situation:

```cpp
struct InnerData {
  void* whatever;
  int32_t refcount;
  int32_t otherStuff;
};

struct TypedValue {
  InnerData* innerData;
  int64_t otherStuff;
};

void yetAnotherFunction() {
  // stuff
}

void someOtherFunction() {
  yetAnotherFunction();
}

void tvIncRef(TypedValue *tv) {
  tv->innerData->refcount++;
}

int bug() {
  TypedValue tv;
  tvIncRef(&tv);

  // other stuff

  return 123;
}

int main()
{
  someOtherFunction();

  int retval = bug();
  printf("bug() returned %d\n", retval);  // Does not print 123
  return 0;
}
```

Where it starts going wrong is the uninitialized `TypedValue` in `bug`[^1]. `tvIncRef` dereferences an uninitialized pointer within it, which can cause any amount of trouble.

[^1]: This didn't immediately stand out to me as a problem because I was new to the codebase; I think I just assumed the type had a default constructor that initialized its members, but it actually doesn't.

But how could this lead to `bug`'s return value disappearing, and no other problems?

The call to `someOtherFunction`, and its call to `yetAnotherFunction`, are important. Those function calls result in stack frames being written to the stack. What they do is mostly irrelevant; what matters is that each call pushes a return address and a saved frame pointer (`%rbp`) value onto the stack, and that `someOtherFunction` doesn't have any stack space allocated for locals.

In `main`, immediately after the call to `someOtherFunction` returns, this is the situation on the stack (remember the stack grows downward in memory):

```
       |                                             |
       +---------------------------------------------+
0x138  | return address from main()                  |
       +---------------------------------------------+
0x130  | saved %rbp from start                       |
       +---------------------------------------------+   <--- %rbp
0x128  |                                             |
       +    main()'s stack frame (locals)            +
0x120  |                                             |
       +---------------------------------------------+   <--- %rsp
0x118  | return address from someOtherFunction()     |   \
       +---------------------------------------------+    |
0x110  | saved %rbp from main()              [0x130] |    |
       +---------------------------------------------+    |
0x108  | return address from yetAnotherFunction()    |    |-- dead
       +---------------------------------------------+    |
0x100  | saved %rbp from someOtherFunction() [0x110] |    |
       +---------------------------------------------+   /
```

With the stack pointer at `0x120`, `main` calls `bug`, so a return address and saved `%rbp` go onto the stack, and the stack pointer is now `0x110`.

Now, in `bug`, `TypedValue tv` is a stack-allocated variable. It's 16 bytes long, so it gets allocated to the 16 bytes of stack below the current stack pointer. Therefore, it's at address `0x100`.

That means `tv` lines up with the now-dead stack frame from the call to `yetAnotherFunction`. In particular, they line up so that the saved `%rbp` value from that stack frame becomes the value of the pointer `tv->innerData`.

Here's the stack just before the call to `tvIncRef`:

```
       |                                              |
       +----------------------------------------------+
0x138  | return address from main()                   |
       +----------------------------------------------+
0x130  | saved %rbp from start                        |
       +----------------------------------------------+
0x128  |                                              |
       +    main()'s stack frame (locals)             +
0x120  |                                              |
       +----------------------------------------------+
0x118  | return address from bug()                    |
       +----------------------------------------------+
0x110  | saved %rbp from main()               [0x130] |
       +------------------------------+---------------+  <--- %rbp
0x108  | ret addr from Y.A.F.         / tv.otherStuff |  \
       +----------------------------------------------+   |- bug()'s
0x100  | %rbp from S.O.F.     [0x110] / tv.innerData  |  /   frame
       +------------------------------+---------------+  <--- %rsp
```

You might now see where this is going.

This means the `InnerData` whose refcount gets incremented is actually a chunk of the stack, at address `0x110`. That means its `whatever` field is at address `0x110`, and its `refcount` field is eight bytes later, at address `0x118`.

So `tvIncRef` will increment the 32-bit integer at address `0x118`. Specifically, it will increment the low-order byte, which is at address `0x118` because this is on x86-64, a little-endian architecture. But as the stack diagram shows, address `0x118` actually contains (the low-order byte of) the _return address_ from `bug`!

Thus we'll increment `bug`'s return address by 1, so after returning, control will end up back in `main`, but one byte past where it should be. Let's look at the `call` instruction and the ones after it:

```x86asm
0x100003f54:  e8 b7 ff ff ff        callq  bug
  ; Move retval to stack
0x100003f59:  89 45 f8              movl   %eax, -0x8(%rbp)
  ; Put retval in second argument register
0x100003f5c:  8b 75 f8              movl   -0x8(%rbp), %esi
  ; Put printf format string in first argument register
0x100003f5f:  48 8d 3d 34 00 00 00  leaq   0x34(%rip), %rdi
  ; No floating-point args
0x100003f66:  b0 00                 movl   $0x0, %al
0x100003f68:  e8 09 00 00 00        callq  printf
```

The instruction following the `call` is moving the return value from `%eax` to the stack slot that the compiler allocated for `retval`. When `bug` returns, control lands in the _middle_ of that `movl` instruction, so it doesn't get executed as it should.

Ordinarily, the processor would decode the bytes `89 45 f8` into the register-to-memory move. Instead, it decodes the bytes `45 f8`. It just so happens that those bytes decode to the instruction `clc`, which clears the carry bit of the flags register. This is completely irrelevant to the subsequent code, so it's effectively a no-op.

The encoding of the `movl` instruction is three bytes long; the encoding of the `clc` instruction is two bytes long[^4]. Therefore, after doing the `clc`, the instruction pointer ends up back on the correct instruction boundary, right at the beginning of the instruction `movl -0x8(%rbp), %esi`. Now everything is back on track, and the program continues on its merry way. The only thing wrong is that the `movl %eax, -0x8(%rbp)` didn't actually happen. Return value: disappeared!

[^4]: Technically, `clc` is encoded as one byte (`f8`) and the `45` byte is decoded as a REX prefix. Apparently it's fine to have a REX prefix on an instruction that doesn't touch the general-purpose registers? Gotta love x86.

_Disclaimer: in the actual HHVM bug, the instruction after the call was something else; either a reg-reg move or a move into a struct field. But the result was the same: chopping off the first byte of it resulted in an instruction that did not copy `%eax` where it was supposed to go, had no noticeable effect, and put execution back on the correct instruction boundary._

## Prevention

The root of the problem is accessing the uninitialized `TypedValue`. In a more, uh, enlightened language than C++, it wouldn't even be possible to create an uninitialized value that easily.

In C++, the statement `TypedValue tv;` runs the type's default constructor, which in this case is a compiler-generated default constructor that does nothing. In a more enlightened language, maybe the generated default constructor would initialize each field to a default value. Or maybe there wouldn't be generated constructors at all, and you would be forced to either write an explicit default constructor or specify initializers for all fields.

In Rust, which I would now always use in preference to C++, you _can_ create an [uninitialized variable](https://doc.rust-lang.org/std/mem/union.MaybeUninit.html), but the compiler will force you to type the word `unsafe` all around it. You will not create an uninitialized variable by accident.

## Conclusion

I love this bug for three reasons:

- You'd normally expect dereferencing an uninitialized pointer to cause big problems, but this bug manifested in the sneakiest way possible. It took me a while to even find the disappearing return value, because who even expects such a thing to happen?
- It's completely inscrutable without understanding the stack discipline and the nature of machine code. It was gratifying to have that knowledge actually come in useful. (Never mind that this happened in a JIT compiler, where that knowledge was essential anyway --- this could have happened in any C++ project.) This bug was beyond the reach of printf debugging; I needed GDB.
- It requires so many things to line up just right, in the code, the compilation[^3], and the runtime environment:
  - The uninitialized `TypedValue` had to be allocated on top of the old stack frame.
  - The `TypedValue`'s inner pointer, and `InnerData`'s refcount field, both had to be at the right offsets within the structs to line up with the right on-stack bits.
  - `yetAnotherFunction` has to save the frame pointer to the stack[^2].
  - The instruction immediately after the `call` had to be moving the return value from `%eax` to somewhere else.
  - Chopping off the first byte of that instruction had to result in a still-valid instruction that didn't cause bigger consequences, and that put execution back on the correct instruction boundary afterwards.
  - In the real HHVM code, `tvIncRef` actually checks another field of the `TypedValue` to determine whether to increment the refcount at all, so that field (also "initialized" with garbage from the stack) had to have a suitable value too.
  - This had to be on a little-endian architecture with variable-width instructions. E.g. it couldn't have happened on ARM because the misaligned instruction pointer would have blown up.

[^2]: On 64-bit x86, `%rbp` isn't always saved to the stack; it can be omitted in leaf functions. It's also possible to compile whole programs without frame pointers at all, but that never applied to HHVM.

Anyway, I spent hours figuring this out and put up the fix for review, only to discover that someone else had already fixed it while I was busy.

[^3]: I don't actually remember if this happened in both debug and optimized builds, or just one. Which configuration makes all the circumstances more likely to line up is left as an exercise to the reader.
