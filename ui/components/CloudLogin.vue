<script setup>
import { cloudUser, cloudPass, loginError, cloudBusy, submitLogin, cancelLogin } from '../cloud.js'

function submit() {
  if (cloudUser.value && cloudPass.value && !cloudBusy.value) submitLogin()
}
</script>

<template>
  <div id="cloud-login-overlay">
    <!-- A real <form> with a submit button so browser/iOS/Android password
         managers offer to save and autofill the credentials. -->
    <form class="cloud-login" @submit.prevent="submit">
      <h2>Studio 161</h2>
      <label>
        Username
        <input type="text" v-model="cloudUser" name="username" autocomplete="username" />
      </label>
      <label>
        Password
        <input type="password" v-model="cloudPass" name="password" autocomplete="current-password" />
      </label>
      <div v-if="loginError" class="login-error">{{ loginError }}</div>
      <div class="login-actions">
        <button type="submit" class="btn-signin" :disabled="cloudBusy || !cloudUser || !cloudPass">
          {{ cloudBusy ? 'Connecting…' : 'Sign In' }}
        </button>
        <button type="button" class="btn-skip" @click="cancelLogin">Use last settings</button>
      </div>
    </form>
  </div>
</template>
