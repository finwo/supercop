#ifndef __MEMCPY_C__
#define __MEMCPY_C__

void * memcpy (void *dest, const void *src, int len)
{
  char *d = dest;
  const char *s = src;
  while (len--)
    *d++ = *s++;
  return dest;
}

#endif // __MEMCPY_C__
