#ifndef __MEMSET_C__
#define __MEMSET_C__

void * memset (void *dest, int val, int len) {
  unsigned char *ptr = dest;
  while (len-- > 0)
    *ptr++ = val;
  return dest;
}

#endif // __MEMSET_C__
