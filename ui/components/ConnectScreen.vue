<script setup>
import { statusText, status, connect } from '../store.js'
import { cloudUser, signOut, requestLogin } from '../cloud.js'
</script>

<template>
  <div id="connect-screen">
    <div class="status">{{ statusText }}</div>
    <div v-if="status === 'connecting'" class="spinner"></div>
    <button v-else @click="connect">Connect</button>
    <div class="cloud-account">
      <template v-if="cloudUser">
        Signed in as {{ cloudUser }} · <a @click="signOut">Sign out</a>
      </template>
      <a v-else @click="requestLogin">Cloud sign-in</a>
    </div>
  </div>
</template>
